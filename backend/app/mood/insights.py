"""Descriptive Daily Reflection insights (D-57).

Counts of what the person chose, over a calendar week or month in their own time zone.
Nothing here infers causes, scores wellbeing or diagnoses: "anxious on 4 days; work was
marked on 3 of them" is reported, "work caused your anxiety" is never said. Days
without a reflection are simply absent; they are not treated as bad days.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assistants.registry import BY_ID
from app.mood.models import MoodCheckin
from app.mood.schemas import CountItem, FactorLink, InsightDay, Insights
from app.users.models import User

MIN_REFLECTIONS = 3  # fewer than this: show a "not enough data yet" state
MAX_LINKS = 6

# Optional suggestions after a reflection: never a diagnosis, ready assistants only.
FACTOR_ASSISTANT = {
    "work": "career",
    "relationships": "relationships",
    "family": "family",
    "studies": "growth",
    "finances": "finance",
    "physical_health": "fitness",
    "exercise": "fitness",
    "sleep": "emotional",
    "social": "social",
    "goals": "growth",
    "other": "everyday",
}
EMOTION_ASSISTANT = {"anxious": "emotional", "sad": "emotional", "frustrated": "emotional"}


def suggested_assistants(emotions: list[str], factors: list[str]) -> list[str]:
    wanted = [FACTOR_ASSISTANT[f] for f in factors] + [
        EMOTION_ASSISTANT[e] for e in emotions if e in EMOTION_ASSISTANT
    ]
    ready = [a for a in dict.fromkeys(wanted) if BY_ID[a].status == "ready"]
    return ready[:3]


def _period(period: Literal["week", "month"], today: date) -> tuple[date, date]:
    if period == "week":
        start = today - timedelta(days=today.weekday())  # Monday
        return start, start + timedelta(days=7)
    start = today.replace(day=1)
    return start, (start + timedelta(days=32)).replace(day=1)


def build_insights(
    session: Session,
    user: User,
    period: Literal["week", "month"],
    offset_minutes: int,
    now: datetime | None = None,
) -> Insights:
    offset = timedelta(minutes=offset_minutes)
    local_now = (now or datetime.now(UTC)) + offset
    start, end = _period(period, local_now.date())
    utc_start = datetime(start.year, start.month, start.day, tzinfo=UTC) - offset
    utc_end = datetime(end.year, end.month, end.day, tzinfo=UTC) - offset
    rows = session.execute(
        select(MoodCheckin.emotions, MoodCheckin.factors, MoodCheckin.submitted_at)
        .where(
            MoodCheckin.user_id == user.id,
            MoodCheckin.entry_version == 2,
            MoodCheckin.submitted_at >= utc_start,
            MoodCheckin.submitted_at < utc_end,
        )
        .order_by(MoodCheckin.submitted_at)
    ).all()

    by_day: dict[date, tuple[set[str], set[str]]] = {}
    for emotions, factors, at in rows:
        feelings, reasons = by_day.setdefault((at + offset).date(), (set(), set()))
        feelings.update(emotions)
        reasons.update(factors)

    emotion_days: Counter[str] = Counter()
    factor_days: Counter[str] = Counter()
    pair_days: Counter[tuple[str, str]] = Counter()
    for feelings, reasons in by_day.values():
        emotion_days.update(feelings)
        factor_days.update(reasons)
        pair_days.update((e, f) for e in feelings for f in reasons if f != "other")

    return Insights(
        period=period,
        start=start,
        end=end,
        reflections=len(rows),
        days_with_reflections=len(by_day),
        enough_data=len(rows) >= MIN_REFLECTIONS,
        emotions=[CountItem(label=k, count=v) for k, v in emotion_days.most_common()],
        factors=[CountItem(label=k, count=v) for k, v in factor_days.most_common()],
        links=[
            FactorLink(emotion=e, factor=f, days=n)
            for (e, f), n in pair_days.most_common()
            if n >= 2
        ][:MAX_LINKS],
        calendar=[InsightDay(day=d, emotions=sorted(f)) for d, (f, _) in sorted(by_day.items())],
    )
