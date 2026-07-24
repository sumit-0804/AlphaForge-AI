from fastapi import HTTPException

from app.services.market_data import MarketDataService
from app.services.trading import TradingService

DEFAULT_MAX_POSITION = 0.25   # no single name > 25% of the book
DEFAULT_MAX_SECTOR = 0.40     # no single sector > 40%
DEFAULT_CASH_RESERVE = 0.10   # always keep 10% in cash

class PortfolioService:

    @staticmethod
    def _weights(items: list[dict], max_pos:float, max_sector:float, iters:int = 25)-> list[float]:
        # Start from the conviction weights and apply the caps until they settle.
        n = len(items)
        w = [it["weight"] for it in items]
        for _ in range(iters):
            changed = False
            # Clamp names over the position cap and spread the excess to those with room.
            excess = 0.0
            for i in range(n):
                if w[i] > max_pos + 1e-9:
                    excess += w[i] - max_pos
                    w[i] = max_pos
                    changed = True
            if excess > 1e-9:
                headroom = sum(max_pos - w[i] for i in range(n) if w[i] < max_pos - 1e-9)
                if headroom > 1e-9:
                    for i in range(n):
                        if w[i] < max_pos - 1e-9:
                            w[i] += excess * (max_pos - w[i]) / headroom

            # Scale any sector that's over its cap back down.
            sectors: dict[str, list[int]] = {}
            for i in range(n):
                sectors.setdefault(items[i]["sector"], []).append(i)
            for idxs in sectors.values():
                s = sum(w[i] for i in idxs)
                if s > max_sector + 1e-9:
                    scale = max_sector / s
                    for i in idxs:
                        w[i] *= scale
                    changed = True

            if not changed:
                break
        return w
    
    @classmethod
    async def allocate(
        cls,
        candidates: list[dict],
        user_id: str,
        capital: float | None = None,
        max_position: float = DEFAULT_MAX_POSITION,
        max_sector: float = DEFAULT_MAX_SECTOR,
        cash_reserve: float = DEFAULT_CASH_RESERVE,
    ) -> dict:
        if not candidates:
            raise HTTPException(400, "No candidates provided")
        
        if capital is None:
            portfolio= await TradingService.get_portfolio(user_id)
            capital = portfolio.cash_balance
        
        items : list[dict] = []
        total_conv = 0.0
        for c in candidates:
            ticker = c["ticker"].upper()
            conv = max(float(c.get("conviction", 1.0)), 0.0)
            try:
                info = MarketDataService.get_stock_info(ticker)
            except Exception:
                continue
            price = info.get("currentPrice")
            if not price:
                continue
            items.append({
                "ticker": ticker,
                "name": info.get("shortName") or info.get("longName") or ticker,
                "sector": info.get("sector") or "Unknown",
                "price": float(price),
                "conviction": conv,
            })
            total_conv += conv
        
        if not items:
            raise HTTPException(400, "No priceable candidates")
        
        for it in items:
            it["weight"] = it["conviction"] / total_conv if total_conv > 0 else 1.0 / len(items)
        for it, w in zip(items, cls._weights(items, max_position, max_sector)):
            it["weight"] = w
        
        investable = capital * (1 - cash_reserve)
        allocations: list[dict] = []
        invested = 0.0
        for it in items:
            shares = int((investable * it["weight"]) // it["price"])
            cost = shares * it["price"]
            invested += cost
            allocations.append({
                "ticker": it["ticker"],
                "name": it["name"],
                "sector": it["sector"],
                "price": round(it["price"], 2),
                "conviction": round(it["conviction"], 3),
                "target_weight": round(it["weight"], 4),
                "shares": shares,
                "cost": round(cost, 2),
            })

        for a in allocations:
            a["actual_weight"] = round(a["cost"] / capital, 4) if capital else 0.0
        
        sector_exposure: dict[str, float] = {}
        for a in allocations:
            sector_exposure[a["sector"]] = round(
                sector_exposure.get(a["sector"], 0.0) + (a["cost"] / capital * 100 if capital else 0), 2
            )
        
        return {
            "capital": round(capital, 2),
            "invested": round(invested, 2),
            "cash_remaining": round(capital - invested, 2),
            "invested_pct": round(invested / capital * 100, 2) if capital else 0.0,
            "constraints": {
                "max_position": max_position,
                "max_sector": max_sector,
                "cash_reserve": cash_reserve,
            },
            "sector_exposure": sector_exposure,
            "allocations": sorted(allocations, key=lambda a: a["cost"], reverse=True),
        }


