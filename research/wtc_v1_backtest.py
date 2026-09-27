#!/usr/bin/env python3
"""
Reproducible historical backtest of WTC MNQ Signal Engine V1.

Source-of-truth production logic is netlify/functions/lib/signal-nq.mts at
commit d4c2fb1dc282292ff14577efe2af0ba89ab07771 (2026-09-27).
Trade lifecycle mirrors netlify/functions/lib/signal-log.mts: an actionable
BUY/SELL opens 1 theoretical MNQ, any WAIT/reversal closes it, and reversal
can open the opposite side on the same bar. Session breaks close at the last
available session price. No stop loss or profit target is applied.

Historical-data differences that are intentionally disclosed in output:
- Public source is a continuous NQ 1-minute dataset rather than tastytrade's
  live active-month DXLink contract feed.
- Production fetches a rolling 7 calendar days of 1m bars. This backtest uses
  streaming indicator state after warm-up; for EMA/MACD periods <= 26, the
  numerical contribution of a seed >7 days old is effectively zero.
- Production fetches ~210 calendar days of daily candles. We emulate that
  window at every CME session boundary and treat the current session close as
  the live/partial daily close to avoid look-ahead.
- Fills are theoretical at the observed 1-minute close. Fees/slippage omitted,
  exactly like the forward site's current theoretical P&L.
"""
from __future__ import annotations

import argparse, json
from collections import deque, defaultdict
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

MNQ_DOLLARS_PER_POINT = 2.0
EMA_K = {n: 2.0 / (n + 1.0) for n in (9, 12, 20, 21, 26, 50)}
MACD_SIGNAL_K = 2.0 / 10.0


def pct(a: float, b: float) -> float:
    return ((a / b) - 1.0) * 100.0 if b else 0.0


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def rsi_from_closes(closes) -> float:
    vals = list(closes)
    if len(vals) < 2:
        return 50.0
    start = max(1, len(vals) - 14)
    gain = loss = 0.0
    count = 0
    for i in range(start, len(vals)):
        d = vals[i] - vals[i - 1]
        if d > 0:
            gain += d
        else:
            loss -= d
        count += 1
    if not count:
        return 50.0
    ag, al = gain / count, loss / count
    if al == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + ag / al))


def ema_seq(values, n: int) -> Optional[float]:
    vals = list(values)
    if not vals:
        return None
    k = 2.0 / (n + 1.0)
    e = float(vals[0])
    for v in vals[1:]:
        e = float(v) * k + e * (1.0 - k)
    return e


def cme_session_open_et(ts: pd.Timestamp) -> bool:
    # Production CT rules translated exactly +1 hour into US/Eastern.
    wd = ts.weekday()  # Mon=0 ... Sun=6
    m = ts.hour * 60 + ts.minute
    if wd == 5:  # Sat
        return False
    if wd == 6:  # Sun
        return m >= 18 * 60
    if wd == 4:  # Fri
        return m < 17 * 60
    return m < 17 * 60 or m >= 18 * 60


def first_five_block_et(ts: pd.Timestamp) -> bool:
    m = ts.hour * 60 + ts.minute
    return cme_session_open_et(ts) and 18 * 60 <= m < 18 * 60 + 5


def cme_session_key_et(ts: pd.Timestamp):
    if not cme_session_open_et(ts):
        return None
    d = ts.date()
    if ts.hour * 60 + ts.minute >= 18 * 60:
        d = d + timedelta(days=1)
    return d


@dataclass
class TFState:
    state: str
    score: int
    rsi: float
    ema: str
    macd: str
    move: float
    e9: float | None = None
    e21: float | None = None


class TimeframeAccumulator:
    """Streaming equivalent of WTC resample()+tfState() for partial current bars."""
    def __init__(self, minutes: int, trigger: bool = False):
        self.minutes = minutes
        self.trigger = trigger
        self.bucket = None
        self.partial_close = None
        self.completed_count = 0
        self.last_completed = deque(maxlen=14)
        self.e9 = self.e21 = self.e12 = self.e26 = self.macd_sig = None

    def _bucket_id(self, ts: pd.Timestamp) -> int:
        # UTC/ET offsets are whole hours, so minute boundaries are identical.
        return (ts.toordinal() * 1440 + ts.hour * 60 + ts.minute) // self.minutes

    @staticmethod
    def _upd(prev: Optional[float], v: float, k: float) -> float:
        return v if prev is None else v * k + prev * (1.0 - k)

    def _finalize(self, close: float):
        self.e9 = self._upd(self.e9, close, EMA_K[9])
        self.e21 = self._upd(self.e21, close, EMA_K[21])
        self.e12 = self._upd(self.e12, close, EMA_K[12])
        self.e26 = self._upd(self.e26, close, EMA_K[26])
        line = self.e12 - self.e26
        self.macd_sig = self._upd(self.macd_sig, line, MACD_SIGNAL_K)
        self.last_completed.append(close)
        self.completed_count += 1

    def update(self, ts: pd.Timestamp, close: float) -> TFState:
        bid = self._bucket_id(ts)
        if self.bucket is None:
            self.bucket = bid
        elif bid != self.bucket:
            if self.partial_close is not None:
                self._finalize(float(self.partial_close))
            self.bucket = bid
        self.partial_close = float(close)
        total_len = self.completed_count + 1
        if total_len < 30:
            return TFState("NEUTRAL", 0, 50.0, "MIXED", "flat", 0.0)

        e9c = self._upd(self.e9, close, EMA_K[9])
        e21c = self._upd(self.e21, close, EMA_K[21])
        e12c = self._upd(self.e12, close, EMA_K[12])
        e26c = self._upd(self.e26, close, EMA_K[26])
        line = e12c - e26c
        sig = self._upd(self.macd_sig, line, MACD_SIGNAL_K)
        prev_close = self.last_completed[-1] if self.last_completed else close
        rr = rsi_from_closes(list(self.last_completed) + [close])

        s = 0
        s += 1 if e9c > e21c else -1
        if rr > 55:
            s += 1
        elif rr < 45:
            s -= 1
        s += 1 if line > sig else -1
        s += 1 if close > prev_close else -1
        prev_e9 = self.e9 if self.e9 is not None else e9c
        s += 1 if e9c > prev_e9 else -1
        threshold = 2 if self.trigger else 3
        state = "BUY" if s >= threshold else "SELL" if s <= -threshold else "NEUTRAL"
        return TFState(
            state=state, score=s, rsi=round(rr),
            ema="BULL" if e9c > e21c else "BEAR",
            macd="UP" if line > sig else "DOWN",
            move=round(pct(close, prev_close), 2), e9=e9c, e21=e21c,
        )


class DailyWindow:
    """~210 calendar-day production daily-candle window with live partial current close."""
    def __init__(self):
        self.completed = deque()  # (session_date, close)
        self.current_key = None
        self.current_close = None
        self.base_e20 = self.base_e50 = None
        self.window_closes = []

    def _rebuild_window(self, new_key):
        cutoff = new_key - timedelta(days=210)
        while self.completed and self.completed[0][0] < cutoff:
            self.completed.popleft()
        self.window_closes = [c for _, c in self.completed]
        self.base_e20 = ema_seq(self.window_closes, 20)
        self.base_e50 = ema_seq(self.window_closes, 50)

    def on_bar(self, session_key, close: float):
        if self.current_key is None:
            self.current_key = session_key
            self._rebuild_window(session_key)
        elif session_key != self.current_key:
            if self.current_close is not None:
                self.completed.append((self.current_key, float(self.current_close)))
            self.current_key = session_key
            self._rebuild_window(session_key)
        self.current_close = float(close)

    def state(self):
        n = len(self.window_closes) + 1
        if n < 55:
            return {"state": "MIXED", "rsi": 50.0, "ema20": 0.0, "ema50": 0.0, "count": n}
        k20, k50 = EMA_K[20], EMA_K[50]
        e20 = self.current_close if self.base_e20 is None else self.current_close * k20 + self.base_e20 * (1 - k20)
        e50 = self.current_close if self.base_e50 is None else self.current_close * k50 + self.base_e50 * (1 - k50)
        rr = rsi_from_closes(self.window_closes[-14:] + [self.current_close])
        state = "MIXED"
        if self.current_close > e50 and e20 > e50 and rr >= 50:
            state = "BULLISH"
        if self.current_close < e50 and e20 < e50 and rr <= 50:
            state = "BEARISH"
        return {"state": state, "rsi": round(rr), "ema20": e20, "ema50": e50, "count": n}


class SessionState:
    def __init__(self):
        self.key = None
        self.start_ts = None
        self.open = None
        self.pv = 0.0
        self.vol = 0.0
        self.or_low = None
        self.or_high = None

    def reset(self, key, ts, o):
        self.key = key
        self.start_ts = ts
        self.open = float(o)
        self.pv = 0.0
        self.vol = 0.0
        self.or_low = None
        self.or_high = None

    def update(self, key, ts, o, h, l, c, v):
        if self.key != key:
            self.reset(key, ts, o)
        typical = (float(h) + float(l) + float(c)) / 3.0
        vol = max(0.0, float(v))
        self.pv += typical * vol
        self.vol += vol
        if ts < self.start_ts + pd.Timedelta(minutes=15):
            self.or_low = float(l) if self.or_low is None else min(self.or_low, float(l))
            self.or_high = float(h) if self.or_high is None else max(self.or_high, float(h))

    @property
    def vwap(self):
        return self.pv / self.vol if self.vol else None

    @property
    def or_mid(self):
        if self.or_low is None or self.or_high is None:
            return None
        return (self.or_low + self.or_high) / 2.0


class Atr14:
    def __init__(self):
        self.prev_close = None
        self.trs = deque(maxlen=14)

    def update(self, h, l, c):
        h, l, c = float(h), float(l), float(c)
        if self.prev_close is not None:
            self.trs.append(max(h - l, abs(h - self.prev_close), abs(l - self.prev_close)))
        self.prev_close = c

    @property
    def value(self):
        return sum(self.trs) / len(self.trs) if self.trs else 0.0


def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    if "datetime" in df.columns:
        dcol = "datetime"
    elif "timestamp_et" in df.columns:
        dcol = "timestamp_et"
    elif "timestamp" in df.columns:
        dcol = "timestamp"
    elif "date" in df.columns and "time" in df.columns:
        df["datetime"] = df["date"].astype(str) + " " + df["time"].astype(str)
        dcol = "datetime"
    else:
        dcol = df.columns[0]
    df["datetime"] = pd.to_datetime(df[dcol], errors="coerce")
    try:
        if df["datetime"].dt.tz is not None:
            df["datetime"] = df["datetime"].dt.tz_convert("US/Eastern").dt.tz_localize(None)
    except Exception:
        pass
    required = ["open", "high", "low", "close", "volume"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}; columns={list(df.columns)}")
    df = df[["datetime"] + required].dropna(subset=["datetime", "open", "high", "low", "close"])
    return df.sort_values("datetime").drop_duplicates("datetime").reset_index(drop=True)


def close_trade(trade, exit_price, ts, exit_signal, exit_reason, trades):
    side = 1.0 if trade["direction"] == "BUY MNQ" else -1.0
    points = (float(exit_price) - float(trade["entry_price"])) * side
    opened, closed = pd.Timestamp(trade["opened_at"]), pd.Timestamp(ts)
    t = dict(trade)
    t.update({
        "closed_at": closed, "exit_price": float(exit_price),
        "exit_signal": exit_signal, "exit_reason": exit_reason,
        "points": points, "theoretical_pnl": points * MNQ_DOLLARS_PER_POINT,
        "duration_minutes": max(0.0, (closed - opened).total_seconds() / 60.0),
    })
    trades.append(t)


def run_backtest(df: pd.DataFrame):
    tf1, tf5 = TimeframeAccumulator(1, True), TimeframeAccumulator(5)
    tf15, tf30 = TimeframeAccumulator(15), TimeframeAccumulator(30)
    daily, sess, atr = DailyWindow(), SessionState(), Atr14()
    trades, open_trade = [], None
    last_session_key = last_session_price = last_session_ts = None
    first_eligible_ts = None
    signal_counts = defaultdict(int)
    rows_session = rows_closed = 0

    for row in df.itertuples(index=False):
        ts = pd.Timestamp(row.datetime)
        o, h, l, c, v = map(float, (row.open, row.high, row.low, row.close, row.volume))
        if not cme_session_open_et(ts):
            rows_closed += 1
            if open_trade is not None and last_session_price is not None:
                close_trade(open_trade, last_session_price, last_session_ts, "WAIT", "CME SESSION CLOSED", trades)
                open_trade = None
            continue

        key = cme_session_key_et(ts)
        rows_session += 1
        if last_session_key is not None and key != last_session_key and open_trade is not None:
            close_trade(open_trade, last_session_price, last_session_ts, "WAIT", "CME SESSION CLOSED", trades)
            open_trade = None

        daily.on_bar(key, c)
        sess.update(key, ts, o, h, l, c, v)
        atr.update(h, l, c)
        t30, t15, t5, t1 = tf30.update(ts, c), tf15.update(ts, c), tf5.update(ts, c), tf1.update(ts, c)
        dstate = daily.state()
        last_session_key, last_session_price, last_session_ts = key, c, ts

        warm = dstate["count"] >= 55 and tf30.completed_count + 1 >= 30
        if not warm:
            continue
        if first_eligible_ts is None:
            first_eligible_ts = ts

        in_entry = not first_five_block_et(ts)
        vw = sess.vwap if sess.vwap is not None else c
        orm = sess.or_mid if sess.or_mid is not None else c
        from_open, m15 = pct(c, sess.open), t15.move

        score = 2 if c > vw else -2
        score += 2 if (t1.e9 is not None and t1.e21 is not None and t1.e9 > t1.e21) else -2
        if sess.or_high is not None and c > sess.or_high:
            score += 2
        elif sess.or_low is not None and c < sess.or_low:
            score -= 2
        if from_open >= 0.25: score += 1
        elif from_open <= -0.25: score -= 1
        if m15 >= 0.05: score += 1
        elif m15 <= -0.05: score -= 1
        if dstate["state"] == "BULLISH": score += 1
        elif dstate["state"] == "BEARISH": score -= 1
        score = int(clamp(score, -9, 9))

        atr_pct = (atr.value / c * 100.0) if c else 0.0
        extension_pct = abs(pct(c, vw))
        extension_limit = max(0.45, min(1.0, atr_pct * 6.0))
        extended = extension_pct > extension_limit

        def threshold_for(side: str):
            if dstate["state"] == "MIXED": return 6
            aligned = ((side == "BUY" and dstate["state"] == "BULLISH") or
                       (side == "SELL" and dstate["state"] == "BEARISH"))
            return 5 if aligned else 7

        bt, st = threshold_for("BUY"), threshold_for("SELL")
        buy_alignment = t30.state == t15.state == t5.state == t1.state == "BUY" and c > vw and c >= orm
        sell_alignment = t30.state == t15.state == t5.state == t1.state == "SELL" and c < vw and c <= orm

        signal, reason = "WAIT", "ALIGNMENT CONFLICT"
        if not in_entry:
            reason = "FIRST 5M BLOCK"
        elif extended:
            reason = f"EXTENSION BLOCK · {extension_pct:.2f}% FROM VWAP"
        elif buy_alignment and score >= bt:
            signal, reason = "BUY MNQ", f"ALL BULLISH · SCORE +{score}/{bt}"
        elif sell_alignment and score <= -st:
            signal, reason = "SELL MNQ", f"ALL BEARISH · SCORE {score}/-{st}"
        elif (t30.state != t15.state) or t5.state == "NEUTRAL" or t1.state == "NEUTRAL":
            reason = "TIMEFRAME CONFLICT · WAIT"
        elif buy_alignment:
            reason = f"BULLISH ALIGNMENT · SCORE +{score} < +{bt}"
        elif sell_alignment:
            reason = f"BEARISH ALIGNMENT · SCORE {score} > -{st}"

        signal_counts[signal] += 1
        actionable = signal in ("BUY MNQ", "SELL MNQ")
        if open_trade is not None and (not actionable or signal != open_trade["direction"]):
            close_trade(open_trade, c, ts, signal, reason, trades)
            open_trade = None
        if actionable and open_trade is None:
            open_trade = {
                "direction": signal, "opened_at": ts, "entry_price": c,
                "entry_score": score, "entry_reason": reason,
                "alignment": f"{t30.state}/{t15.state}/{t5.state}/{t1.state}",
                "daily_state": dstate["state"],
            }

    if open_trade is not None and last_session_price is not None:
        close_trade(open_trade, last_session_price, last_session_ts, "WAIT", "BACKTEST END", trades)
    return trades, {
        "first_eligible": str(first_eligible_ts) if first_eligible_ts is not None else None,
        "session_rows": rows_session, "closed_session_rows": rows_closed,
        "signal_minutes": dict(signal_counts),
    }


def summarize(trades, df, diag):
    pnl, pts = [t["theoretical_pnl"] for t in trades], [t["points"] for t in trades]
    wins, losses = [x for x in pnl if x > 0], [x for x in pnl if x < 0]
    flats = [x for x in pnl if x == 0]
    total, gross_win, gross_loss = sum(pnl), sum(wins), -sum(losses)
    pf = gross_win / gross_loss if gross_loss else None
    cum = peak = max_dd = 0.0
    max_losing_streak = streak = 0
    for x in pnl:
        cum += x; peak = max(peak, cum); max_dd = max(max_dd, peak - cum)
        if x < 0:
            streak += 1; max_losing_streak = max(max_losing_streak, streak)
        else:
            streak = 0

    by_year = {}
    for y in sorted({pd.Timestamp(t["opened_at"]).year for t in trades}):
        rows = [t for t in trades if pd.Timestamp(t["opened_at"]).year == y]
        yp = [t["theoretical_pnl"] for t in rows]; yw = sum(x > 0 for x in yp)
        by_year[str(y)] = {"trades": len(rows), "wins": yw,
            "win_rate_pct": round(100*yw/len(rows), 2), "pnl": round(sum(yp), 2),
            "points": round(sum(t["points"] for t in rows), 2)}

    by_side = {}
    for side in ("BUY MNQ", "SELL MNQ"):
        rows = [t for t in trades if t["direction"] == side]
        sp = [t["theoretical_pnl"] for t in rows]; sw = sum(x > 0 for x in sp)
        by_side[side] = {"trades": len(rows), "win_rate_pct": round(100*sw/len(rows), 2) if rows else None,
            "pnl": round(sum(sp), 2), "avg_pnl": round(sum(sp)/len(rows), 2) if rows else None}

    by_score = {}
    for score in sorted({t["entry_score"] for t in trades}):
        rows = [t for t in trades if t["entry_score"] == score]; sp = [t["theoretical_pnl"] for t in rows]
        by_score[str(score)] = {"trades": len(rows), "win_rate_pct": round(100*sum(x > 0 for x in sp)/len(rows), 2), "pnl": round(sum(sp), 2)}

    def bucket(t):
        h = pd.Timestamp(t["opened_at"]).hour
        if h < 6: return "overnight_00_06_ET"
        if h < 9: return "morning_06_09_ET"
        if h < 12: return "US_open_09_12_ET"
        if h < 16: return "US_mid_12_16_ET"
        if h < 17: return "US_close_16_17_ET"
        return "evening_18_24_ET"
    by_time = {}
    for b in sorted({bucket(t) for t in trades}):
        rows = [t for t in trades if bucket(t) == b]; sp = [t["theoretical_pnl"] for t in rows]
        by_time[b] = {"trades": len(rows), "win_rate_pct": round(100*sum(x > 0 for x in sp)/len(rows),2), "pnl": round(sum(sp),2)}

    return {
        "strategy": "WTC MNQ Signal Engine V1",
        "production_signal_source_commit": "d4c2fb1dc282292ff14577efe2af0ba89ab07771",
        "trade_lifecycle": "signal-to-signal; no fixed stop/target; 1 MNQ; WAIT/reversal/session close exits",
        "data": {"rows": int(len(df)), "first_timestamp_et": str(df["datetime"].iloc[0]), "last_timestamp_et": str(df["datetime"].iloc[-1]), **diag},
        "all_time": {
            "trades": len(trades), "wins": len(wins), "losses": len(losses), "flats": len(flats),
            "win_rate_pct": round(100*len(wins)/len(trades), 2) if trades else None,
            "points": round(sum(pts), 2), "theoretical_pnl_1_mnq": round(total, 2),
            "avg_trade_pnl": round(total/len(trades), 2) if trades else None,
            "avg_win": round(sum(wins)/len(wins), 2) if wins else None,
            "avg_loss": round(sum(losses)/len(losses), 2) if losses else None,
            "profit_factor": round(pf, 3) if pf is not None else None,
            "max_closed_trade_drawdown": round(max_dd, 2), "max_losing_streak": max_losing_streak,
            "median_duration_minutes": round(float(pd.Series([t["duration_minutes"] for t in trades]).median()), 1) if trades else None,
        },
        "by_year": by_year, "by_side": by_side, "by_entry_score": by_score, "by_entry_time": by_time,
        "limitations": [
            "Continuous public NQ history is not identical to tastytrade active-month DXLink candles, especially around quarterly rolls.",
            "Backtest uses 1-minute bar-close theoretical fills and excludes commissions, exchange fees and slippage.",
            "Daily regime is reconstructed from CME-session closes with a live partial current-session close; provider daily-candle boundaries may differ slightly.",
            "EMA/MACD state is streamed after warm-up instead of re-seeding from the beginning of every rolling 7-day fetch; with periods <=26 the old-seed influence is effectively zero.",
        ],
    }


def write_trades(trades, path):
    rows = []
    for t in trades:
        rows.append({
            "direction": t["direction"], "opened_at_et": t["opened_at"], "closed_at_et": t["closed_at"],
            "entry_price": round(t["entry_price"], 2), "exit_price": round(t["exit_price"], 2),
            "entry_score": t["entry_score"], "entry_reason": t["entry_reason"], "alignment": t["alignment"],
            "daily_state": t["daily_state"], "exit_signal": t["exit_signal"], "exit_reason": t["exit_reason"],
            "points": round(t["points"], 2), "theoretical_pnl_1_mnq": round(t["theoretical_pnl"], 2),
            "duration_minutes": round(t["duration_minutes"], 1),
        })
    pd.DataFrame(rows).to_csv(path, index=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="wtc_v1_backtest_results.json")
    ap.add_argument("--trades", default="wtc_v1_backtest_trades.csv")
    args = ap.parse_args()
    df = load_data(args.csv)
    trades, diag = run_backtest(df)
    summary = summarize(trades, df, diag)
    Path(args.out).write_text(json.dumps(summary, indent=2, default=str))
    write_trades(trades, args.trades)
    print("WTC_BACKTEST_RESULT_START")
    print(json.dumps(summary, indent=2, default=str))
    print("WTC_BACKTEST_RESULT_END")

if __name__ == "__main__":
    main()
