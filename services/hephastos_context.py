"""Owner-scoped work facts, not credentials or a substitute for live evidence."""
import os
from datetime import datetime, timezone
from pathlib import Path
import shutil

FACTS = (
    'مينا يستخدم Hephastos كـ Cloud-Native Engineering & Operations Command Center، وOdysseus AI كمساعد شخصي. المشروعان مستقلان ومتصلان؛ ليسا تطبيقًا واحدًا.',
    'مستودع Hephastos على Linux هو /home/mina/Odysseus والبرانش feature/hephastos-ultimate-upgrade. مستودع المساعد منفصل في /home/mina/odysseus-Ai. هذه معلومات سياق وليست إذنًا بتعديل الكود.',
    'مشاريع مينا الرئيسية: Mal3aby (ملعبي)، Eshtry-Mny (اشتري مني)، وBoutique / Google DevSecOps. لا تخلط بينها وبين أدوات المنصة أو تعتبر كل Pod مشروعًا مستقلًا.',
    'بحسب طلب المستخدم تم نقل المشاريع الثلاثة إلى كلاستر الماك OpenChoreo، والمطلوب عدم تكرار تشغيلها على Linux. تحقق من الحالة الفعلية عبر read_hephastos قبل تأكيد التشغيل أو الموقع الحالي.',
    'Linux وOpenChoreo كلاستران Kubernetes مستقلان، وليس لهما شبكة مدمجة تلقائيًا. للماك سياق k3d-openchoreo؛ عناوين الشبكة والتوصيل قابلة للتغيير ولا تعتبرها دليل اتصال حي.',
    'صفحات المستخدم الشخصية وبياناتها تخص حساب admin في Odysseus: Day Organizer، Idea Inbox، Scripts Library، Learning، Bookmarks، File Sharing، Quick Launcher. تخزن السجلات والمرفقات في قاعدة بيانات Odysseus على تخزين دائم؛ بيانات المصدر محفوظة كمرجع للاسترجاع.',
    'Odysseus يقرأ بيانات Hephastos الحية ويقترح تعديلات بيانات مساحة العمل للموافقة. لا يملك صلاحية نشر أو إيقاف أو حذف workloads، ولا pod exec ولا تشغيل shell أو scripts أو تعديل كود نيابة عن المساعد.',
    'مينا يفضل واجهات واضحة ومنظمة وعملية ببيانات حقيقية، ويطلب الحفاظ على المشاريع والبيانات وتقليل استهلاك الموارد. لا تقل تم التنفيذ أو سليم بدون اختبار ودليل، ولا تحفظ الأسرار أو كلمات المرور في الذاكرة.',
    'Kubernetes مصدر حقيقة التشغيل، PostgreSQL مصدر بيانات Hephastos الهندسية، وقاعدة Odysseus مصدر بيانات مساحة العمل الشخصية. Prometheus مصدر القياسات عند توفره. فقد الاتصال يعني Unknown وليس Healthy.',
    'عند سؤال مينا عن عمله: استخدم الذاكرة لفهم السياق، ثم read_hephastos للقائمة الحية للمشاريع والتولز والكلاسترات وinventory بالكلاستر المحدد، وmanage_productivity لبيانات صفحاته. لا تقدم أعداد بودات أو استخدام RAM أو صحة من الذاكرة القديمة.',
)
SOURCE = 'hephastos-work-context-v1'

def seed_work_context(manager):
    owner=os.environ.get('HEPHASTOS_WORKSPACE_OWNER')
    if not owner:return
    from core.database import SessionLocal, ProductivityEvent, CrewMember
    with SessionLocal() as db:
        if db.query(ProductivityEvent.id).filter_by(owner=owner,action='memory.work-context.seeded').first():return
    entries=manager.load_all_for_update()
    known={entry.get('text') for entry in entries if entry.get('owner')==owner and entry.get('source')==SOURCE}
    missing=[text for text in FACTS if text not in known]
    path=Path(manager.memory_file)
    backup=path.parent/'backups'/f'memory-before-hephastos-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")}.json'
    backup.parent.mkdir(mode=0o700,exist_ok=True)
    if missing:
        shutil.copy2(path,backup);os.chmod(backup,0o600)
        entries.extend(manager.add_entry(text,source=SOURCE,category='fact',owner=owner) for text in missing)
        manager.save(entries)
    from uuid import uuid4
    with SessionLocal.begin() as db:
        crew=db.query(CrewMember).filter_by(owner=owner,is_default_assistant=True).first()
        if crew:
            hint='[Hephastos work context] Use read_hephastos(context) for the owner\'s work facts and projects/tasks/clusters/inventory/tools for current evidence. Saved memory is not live health. Manage the seven personal tools through manage_productivity with human-approved changes; infrastructure remains read-only.'
            if '[Hephastos work context]' not in (crew.personality or ''):crew.personality=(crew.personality or '')+'\n\n'+hint
        db.add(ProductivityEvent(id=str(uuid4()),owner=owner,action='memory.work-context.seeded',collection='memory',record_ids=[]))

def work_context(owner):
    from services.hephastos import require_owner
    from src.constants import DATA_DIR
    from src.memory import MemoryManager
    require_owner(owner)
    entries=MemoryManager(DATA_DIR).load(owner=owner)
    return {'source':'odysseus.owner-memory','observedAt':datetime.now(timezone.utc).isoformat(),
            'kind':'saved-context-not-live-runtime','facts':[entry['text'][:1500] for entry in entries if entry.get('source')==SOURCE][:20]}
