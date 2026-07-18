import asyncio
from fastapi import HTTPException
from typing import List
from app.models.trading import Portfolio, Transaction, Position
from app.services.market_data import MarketDataService
from app.services.forex import ForexService, normalize, major_units
from app.core.config import settings
from app.core.exchanges import currency_for_ticker
from app.agents.reflection_agent import ReflectionAgentService

_bg_tasks: set = set()
async def _safe_reflect(user_id: str, ticker: str, quantity: int, buy_price: float, sell_price: float) -> None:
    try:
        await ReflectionAgentService.reflect(ticker, quantity, buy_price, sell_price, user_id)
    except Exception:
        pass 


def _position_currency(pos: Position) -> str:
    # Positions opened before currency support carry no code; the ticker suffix
    # is authoritative enough to backfill one.
    return normalize(pos.currency or currency_for_ticker(pos.ticker))[0]


class TradingService:
    @staticmethod
    async def get_portfolio(user_id:str ="default_user") -> Portfolio:
        portfolio = await Portfolio.find_one(Portfolio.user_id == user_id)

        if not portfolio:
            portfolio= Portfolio(
                user_id=user_id,
                cash_balance=100000.0,
                base_currency=settings.base_currency,
            )
            await portfolio.insert()

        if not portfolio.base_currency:
            # Pre-existing book: adopt the configured base rather than leaving
            # the denomination undefined.
            portfolio.base_currency = settings.base_currency
            await portfolio.save()

        return portfolio

    @staticmethod
    async def get_portfolio_summary(user_id: str = "default_user") -> dict:
        portfolio = await TradingService.get_portfolio(user_id)
        base = portfolio.base_currency or settings.base_currency

        # One rate per distinct listing currency, fetched concurrently — not one
        # lookup per position.
        rates = await ForexService.rates_to_base(
            {_position_currency(p) for p in portfolio.positions}, base
        )

        total_value = portfolio.cash_balance   # already in base
        invested_base = 0.0
        positions_summary = []
        unconverted: list[str] = []

        for pos in portfolio.positions:
            native = _position_currency(pos)
            try:
                stock_info = MarketDataService.get_stock_info(pos.ticker)
                # Fold minor units (pence) into the price so it is directly
                # comparable with the stored average_buy_price.
                current_price, _ = major_units(
                    stock_info.get("currentPrice"), stock_info.get("currency")
                )
                if current_price is None:
                    current_price = pos.average_buy_price
            except Exception:
                current_price = pos.average_buy_price

            # --- native currency: what the exchange quotes -------------------
            current_value = pos.quantity * current_price
            cost_native = pos.quantity * pos.average_buy_price
            pnl = current_value - cost_native
            pnl_percent = (pnl / cost_native) * 100 if cost_native > 0 else 0

            # --- base currency: what the book is worth ------------------------
            rate = rates.get(native)
            cost_base = pos.cost_basis_base
            if cost_base is None:
                # Legacy position: no recorded cash outlay. Best available proxy
                # is today's rate on the native cost.
                cost_base = cost_native * rate if rate is not None else None

            if rate is None:
                # Refuse to guess. The position still renders in its own
                # currency; it just cannot join the base-currency total.
                current_value_base = None
                unconverted.append(pos.ticker)
            else:
                current_value_base = pos.quantity * current_price * rate
                total_value += current_value_base
                if cost_base is not None:
                    invested_base += cost_base

            positions_summary.append({
                "ticker": pos.ticker,
                "quantity": pos.quantity,
                "currency": native,
                "average_buy_price": pos.average_buy_price,
                "current_price": current_price,
                "current_value": round(current_value, 2),
                "pnl": round(pnl, 2),
                "pnl_percent": round(pnl_percent, 2),
                # Base-currency mirrors, so the UI never has to do FX itself.
                "base_currency": base,
                "fx_rate": round(rate, 6) if rate is not None else None,
                "current_value_base": (
                    round(current_value_base, 2) if current_value_base is not None else None
                ),
                "cost_basis_base": round(cost_base, 2) if cost_base is not None else None,
                "pnl_base": (
                    round(current_value_base - cost_base, 2)
                    if current_value_base is not None and cost_base is not None
                    else None
                ),
            })

        # P&L against what was actually spent plus cash still on hand, rather
        # than a hardcoded 100000 — the seed is only correct for a fresh book in
        # the base currency, and says nothing once FX is involved.
        total_pnl = total_value - (portfolio.cash_balance + invested_base)

        return {
            "user_id": portfolio.user_id,
            "base_currency": base,
            "cash_balance": round(portfolio.cash_balance, 2),
            "total_portfolio_value": round(total_value, 2),
            "total_pnl": round(total_pnl, 2),
            # Non-empty when a rate lookup failed: those positions are excluded
            # from the total, so the UI should say so rather than imply exactness.
            "unconverted": unconverted,
            "positions": positions_summary,
        }
    @staticmethod
    async def execute_trade(user_id: str, ticker:str, action:str, quantity:int) -> Transaction:
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
        
        action = action.lower()
        if action not in ["buy", "sell"]:
            raise HTTPException(status_code=400, detail="Action must be buy or sell")
        
        ticker =ticker.upper()

        try:
            stock_info = MarketDataService.get_stock_info(ticker)
            current_price = stock_info.get("currentPrice")
            if not current_price:
                raise ValueError("Price not found")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"could not fetch price for {ticker}: {str(e)}")

        portfolio = await TradingService.get_portfolio(user_id)
        base = portfolio.base_currency or settings.base_currency
        # Restate to major units first: LSE quotes arrive in pence, and pricing a
        # pence figure at the GBP rate would inflate the trade 100x.
        current_price, native = major_units(
            current_price, stock_info.get("currency") or currency_for_ticker(ticker)
        )

        # The trade is priced in the stock's own currency but settles against a
        # cash balance held in `base`. Convert before touching cash — debiting a
        # ₹ amount from a ₹-denominated balance is only a no-op when they match.
        fx_rate = await ForexService.rate(native, base)
        if fx_rate is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Cannot convert {native} to {base} right now, so this trade "
                    f"cannot be settled. Try again shortly."
                ),
            )

        total_cost = current_price * quantity          # native
        total_cost_base = total_cost * fx_rate         # what cash actually moves

        pos_index = next((i for i,p in enumerate(portfolio.positions) if p.ticker == ticker), -1)

        if action == "buy":
            if portfolio.cash_balance < total_cost_base:
                raise HTTPException(status_code=400, detail="insufficient funds")

            portfolio.cash_balance -= total_cost_base

            if pos_index >= 0:
                existing_pos = portfolio.positions[pos_index]
                total_value_before = existing_pos.quantity * existing_pos.average_buy_price
                new_total_quantity = existing_pos.quantity + quantity
                new_avg_price = (total_value_before + total_cost)/ new_total_quantity

                # A position opened before currency support has no recorded cash
                # outlay. Treating that as 0 would book the whole original stake
                # as profit, so approximate it at today's rate instead.
                prior_basis = existing_pos.cost_basis_base
                if prior_basis is None:
                    prior_basis = total_value_before * fx_rate

                portfolio.positions[pos_index].quantity = new_total_quantity
                portfolio.positions[pos_index].average_buy_price = new_avg_price
                portfolio.positions[pos_index].currency = native
                portfolio.positions[pos_index].cost_basis_base = prior_basis + total_cost_base
            else:
                portfolio.positions.append(Position(
                    ticker=ticker,
                    quantity=quantity,
                    average_buy_price=current_price,
                    currency=native,
                    cost_basis_base=total_cost_base,
                ))

        elif action == "sell":
            if pos_index < 0 or portfolio.positions[pos_index].quantity < quantity:
                raise HTTPException(status_code=400, detail="Insufficient shares to sell")

            existing_pos = portfolio.positions[pos_index]
            avg_buy_price = existing_pos.average_buy_price
            portfolio.cash_balance += total_cost_base

            # Retire the sold fraction of the cost basis so a partial sale leaves
            # the remainder carrying its own share and no more.
            if existing_pos.cost_basis_base is not None and existing_pos.quantity > 0:
                sold_fraction = quantity / existing_pos.quantity
                existing_pos.cost_basis_base -= existing_pos.cost_basis_base * sold_fraction

            existing_pos.quantity -= quantity

            if existing_pos.quantity == 0:
                portfolio.positions.pop(pos_index)

        await portfolio.save()

        # Record transaction
        transaction = Transaction(
            user_id=user_id,
            ticker=ticker,
            action=action,
            quantity=quantity,
            price=current_price,
            currency=native,
            fx_rate=fx_rate,
            base_currency=base,
            total_base=round(total_cost_base, 2),
        )
        await transaction.insert()
        if action == "sell":
            task = asyncio.create_task(
                _safe_reflect(user_id, ticker, quantity, avg_buy_price, current_price)
            )
            _bg_tasks.add(task)
            task.add_done_callback(_bg_tasks.discard)
        return transaction
    
    @staticmethod
    async def get_transaction_history(user_id:str="default_user", limit:int = 50) -> List[Transaction]:
        return await Transaction.find(Transaction.user_id == user_id).sort("-timestamp").limit(limit).to_list()