from fastapi import HTTPException
from typing import List
from app.models.trading import Portfolio, Transaction, Position
from app.services.market_data import MarketDataService

class TradingService:
    @staticmethod
    async def get_portfolio(user_id:str ="default_user") -> Portfolio:
        portfolio = await Portfolio.find_one(Portfolio.user_id == user_id)

        if not portfolio:
            portfolio= Portfolio(user_id=user_id, cash_balance=100000.0)
            await portfolio.insert()
        
        return portfolio
    
    @staticmethod
    async def get_portfolio_summary(user_id: str = "default_user") -> dict:
        portfolio = await TradingService.get_portfolio(user_id)

        total_value = portfolio.cash_balance
        positions_summary = []

        for pos in portfolio.positions:
            try:
                stock_info = MarketDataService.get_stock_info(pos.ticker)
                current_price = stock_info.get("currentPrice", pos.average_buy_price)
            except Exception:
                current_price = pos.average_buy_price

            current_value = pos.quantity * current_price
            total_value += current_value
            pnl = current_value - (pos.quantity * pos.average_buy_price)
            pnl_percent = (pnl / (pos.quantity * pos.average_buy_price)) * 100 if pos.average_buy_price > 0 else 0

            positions_summary.append({
                "ticker": pos.ticker,
                "quantity": pos.quantity,
                "average_buy_price": pos.average_buy_price,
                "current_price": current_price,
                "current_value": round(current_value, 2),
                "pnl": round(pnl, 2),
                "pnl_percent": round(pnl_percent, 2),
            })

        total_pnl = total_value - 100000.0

        return {
            "user_id": portfolio.user_id,
            "cash_balance": round(portfolio.cash_balance, 2),
            "total_portfolio_value": round(total_value, 2),
            "total_pnl": round(total_pnl, 2),
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
        total_cost = current_price * quantity

        pos_index = next((i for i,p in enumerate(portfolio.positions) if p.ticker == ticker), -1)

        if action == "buy":
            if portfolio.cash_balance < total_cost:
                raise HTTPException(status_code=400, detail="insufficient funds")
            
            portfolio.cash_balance -= total_cost

            if pos_index >= 0:
                existing_pos = portfolio.positions[pos_index]
                total_value_before = existing_pos.quantity * existing_pos.average_buy_price
                new_total_quantity = existing_pos.quantity + quantity
                new_avg_price = (total_value_before + total_cost)/ new_total_quantity

                portfolio.positions[pos_index].quantity = new_total_quantity

                portfolio.positions[pos_index].average_buy_price = new_avg_price
            else:
                portfolio.positions.append(Position(ticker=ticker, quantity=quantity, average_buy_price = current_price))

        elif action == "sell":
            if pos_index < 0 or portfolio.positions[pos_index].quantity < quantity:
                raise HTTPException(status_code=400, detail="Insufficient shares to sell")
            
            portfolio.cash_balance += total_cost
            portfolio.positions[pos_index].quantity -= quantity

            if portfolio.positions[pos_index].quantity == 0:
                portfolio.positions.pop(pos_index)
            
        await portfolio.save()

        # Record transaction
        transaction = Transaction(
            user_id=user_id,
            ticker=ticker,
            action=action,
            quantity=quantity,
            price=current_price
        )
        await transaction.insert()

        return transaction
    
    @staticmethod
    async def get_transaction_history(user_id:str="default_user", limit:int = 50) -> List[Transaction]:
        return await Transaction.find(Transaction.user_id == user_id).sort("-timestamp").limit(limit).to_list()