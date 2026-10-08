"""Day reminders delivered through Odysseus' existing durable notifications."""
import asyncio
import logging
import os
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from core.database import SessionLocal, ProductivityRecord, NotificationLog

def reminder_stage(item,now):
    if item.get('done') or item.get('date')!=now.date().isoformat(): return None
    try:
        start=time.fromisoformat(item['time']) if item.get('time') else None
        scheduled=datetime.combine(now.date(),start,now.tzinfo) if start else None
        minutes=(scheduled-now).total_seconds()/60 if scheduled else None
        if minutes is not None and -2<minutes<=0:return 'now'
        if item.get('reminder_time'):
            reminder=datetime.combine(now.date(),time.fromisoformat(item['reminder_time']),now.tzinfo)
            if timedelta()<=now-reminder<timedelta(minutes=2):return 'reminder'
        elif minutes is not None and 0<minutes<=max(0,int(item.get('notify_minutes',10))):return 'soon'
    except (ValueError,TypeError,KeyError):return None
    return None

async def reminder_loop(scheduler):
    owner=os.environ.get('HEPHASTOS_WORKSPACE_OWNER')
    if not owner:return
    from routes.prefs_routes import _load_for_user
    while True:
        try:
            zone=_load_for_user(owner).get('timezone') or os.environ.get('HEPHASTOS_WORKSPACE_TIMEZONE','Africa/Cairo')
            now=datetime.now(ZoneInfo(zone))
            with SessionLocal() as db:
                rows=db.query(ProductivityRecord).filter_by(owner=owner,collection='calendar_items').filter(ProductivityRecord.payload['date'].as_string()==now.date().isoformat()).all()
                for row in rows:
                    stage=reminder_stage(row.payload,now)
                    identifier=f'planner:{row.record_id}:{now.date()}:{stage}'
                    if not stage or db.query(NotificationLog.id).filter_by(owner=owner,task_id=identifier).first():continue
                    message=row.payload.get('notify_message') or f"{'Due now' if stage=='now' else 'Reminder'} — {row.payload.get('title','Task')}"
                    scheduler.add_notification('Day Organizer','success',task_id=identifier,owner=owner,body=message)
        except asyncio.CancelledError:raise
        except Exception:logging.getLogger(__name__).warning('Planner reminders unavailable; saved tasks remain intact')
        await asyncio.sleep(30)
