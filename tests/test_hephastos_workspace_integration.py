"""Run with unittest in an isolated ODYSSEUS_DATA_DIR; no live user data needed."""
import asyncio
import os
import unittest
from unittest.mock import patch

from services.hephastos import read_hephastos
from services.productivity import COLLECTIONS, import_snapshot, export_snapshot, query_collection


class WorkspaceIntegrationTests(unittest.TestCase):
    def setUp(self):
        from core.database import SessionLocal, ProductivityRecord, ProductivityEvent
        with SessionLocal.begin() as db:
            db.query(ProductivityEvent).delete()
            db.query(ProductivityRecord).delete()

    def capture(self):
        snapshot = {name: [] for name in COLLECTIONS}
        snapshot["bookmarks"] = [{"id": "old-link", "title": "Saved link", "url": "https://example.org", "pinned": True}]
        snapshot["shared_items"] = [{"id": "old-file", "title": "Original file", "data_base64": "AAECAw==", "size_bytes": 4}]
        return snapshot

    def test_full_capture_roundtrip_and_owner_isolation(self):
        source = self.capture()
        self.assertEqual(import_snapshot("admin", source), 2)
        self.assertEqual(export_snapshot("admin"), source)
        self.assertTrue(all(not rows for rows in export_snapshot("other-user").values()))
        self.assertEqual(query_collection("other-user", "bookmarks", {}), [])

    def test_launcher_crud_and_unsafe_urls(self):
        saved=query_collection('admin','quick_links',{'action':'insert','values':{'title':'Workspace','url':'https://example.org','favorite':True},'single':'required'})
        self.assertTrue(saved['favorite'])
        self.assertEqual(query_collection('other','quick_links',{}),[])
        for url in ['javascript:alert(1)','https://user:password@example.org','file:///etc/passwd']:
            with self.assertRaises(ValueError):query_collection('admin','quick_links',{'action':'insert','values':{'title':'Unsafe','url':url}})

    def test_project_knowledge_is_persistent_bounded_and_owner_scoped(self):
        from services.project_knowledge import save_dossiers,read_knowledge
        dossier={'id':'project-test','title':'Project','source':'hephastos.project-archive','observedAt':'2026-10-09',
                 'catalog':{'revision':'abc','coverage':{'complete':False}},'contents':{'src/main.py':{'content':'\n'.join(str(i) for i in range(350))},'long.txt':{'content':'a'*17000}}}
        with patch.dict(os.environ,{'HEPHASTOS_WORKSPACE_OWNER':'admin'}):
            save_dossiers('admin',[dossier])
            self.assertTrue(read_knowledge('admin')['available'])
            saved=read_knowledge('admin','project-test','src/main.py',201)
            self.assertEqual(saved['startLine'],201)
            self.assertEqual(saved['totalLines'],350)
            self.assertTrue(saved['text'].startswith('200\n'))
            self.assertEqual(read_knowledge('admin','project-test')['revision'],'abc')
            self.assertTrue(read_knowledge('admin','project-test')['truncated'])
            first=read_knowledge('admin','project-test','long.txt')
            last=read_knowledge('admin','project-test','long.txt',first['nextLine'],first['nextCharacterOffset'])
            self.assertEqual(first['text']+last['text'],'a'*17000)
            with self.assertRaises(PermissionError):read_knowledge('other','project-test')
            with self.assertRaises(ValueError):read_knowledge('admin','project-test','../../private')
            with self.assertRaises(ValueError):query_collection('admin','project_knowledge',{'action':'delete'})

    def test_work_memory_is_idempotent_and_owner_scoped(self):
        import tempfile
        from src.memory import MemoryManager
        from services.hephastos_context import seed_work_context,FACTS
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'HEPHASTOS_WORKSPACE_OWNER':'admin'}):
            manager=MemoryManager(folder)
            seed_work_context(manager);seed_work_context(manager)
            self.assertEqual(len(manager.load(owner='admin')),len(FACTS))
            self.assertEqual(manager.load(owner='other'),[])

    def test_conflict_does_not_overwrite_or_partially_import(self):
        import_snapshot("admin", self.capture())
        replacement = self.capture()
        replacement["bookmarks"][0]["title"] = "Unexpected replacement"
        replacement["ideas"] = [{"id": "new", "title": "Should roll back"}]
        with self.assertRaises(ValueError): import_snapshot("admin", replacement)
        self.assertEqual(export_snapshot("admin"), self.capture())

    def test_crud_and_daily_upsert_keep_ids_and_fields(self):
        saved = query_collection("admin", "calendar_items", {"action": "insert", "values": {"title": "Task", "date": "2026-10-08", "reminder_time": "09:37", "notify_message": "My message"}, "single": "required"})
        self.assertEqual(saved["reminder_time"], "09:37")
        self.assertEqual(saved["notify_message"], "My message")
        query_collection("admin", "calendar_items", {"action": "update", "values": {"done": True}, "filters": [{"field": "id", "op": "eq", "value": saved["id"]}]})
        self.assertTrue(query_collection("admin", "calendar_items", {"single": "required"})["done"])
        for notes in ["first", "updated"]:
            query_collection("admin", "daily_entries", {"action": "upsert", "values": {"date": "2026-10-08", "raw_notes": notes}})
        self.assertEqual(query_collection("admin", "daily_entries", {"single": "required"})["raw_notes"], "updated")

    def test_no_unscoped_mutation_and_no_unknown_collection(self):
        for action in ["update", "delete"]:
            with self.assertRaises(ValueError): query_collection("admin", "bookmarks", {"action": action})
        with self.assertRaises(ValueError): query_collection("admin", "operator_users", {})

    def test_attachment_children_delete_only_with_own_parent(self):
        for owner in ["admin", "other"]:
            query_collection(owner, "shared_items", {"action": "insert", "values": {"id": "parent", "title": "Files"}})
            query_collection(owner, "shared_item_files", {"action": "insert", "values": {"id": "child", "item_id": "parent", "data_base64": "AA==", "size_bytes": 1}})
        query_collection("admin", "shared_items", {"action": "delete", "filters": [{"field": "id", "op": "eq", "value": "parent"}]})
        self.assertEqual(query_collection("admin", "shared_item_files", {}), [])
        self.assertEqual(len(query_collection("other", "shared_item_files", {})), 1)

    def test_machine_connection_is_account_bound_and_not_a_proxy(self):
        with patch.dict(os.environ, {"HEPHASTOS_WORKSPACE_OWNER": "admin"}):
            with self.assertRaises(PermissionError): asyncio.run(read_hephastos("clusters", owner="other"))
            with self.assertRaises(ValueError): asyncio.run(read_hephastos("delete", owner="admin"))

    def test_agent_changes_require_approval_and_cannot_be_replayed(self):
        from services.productivity_proposals import propose, decide
        proposal=propose('admin','bookmarks',{'action':'insert','values':{'title':'Reviewed','url':'https://example.org'}})
        self.assertEqual(query_collection('admin','bookmarks',{}),[])
        with self.assertRaises(ValueError): decide('other',proposal['proposal_id'],True)
        decide('admin',proposal['proposal_id'],True)
        self.assertEqual(len(query_collection('admin','bookmarks',{})),1)
        with self.assertRaises(ValueError): decide('admin',proposal['proposal_id'],True)

    def test_stale_proposal_cannot_replace_newer_data(self):
        from services.productivity_proposals import propose, decide
        import_snapshot('admin',self.capture())
        operation={'action':'update','values':{'title':'Proposed'},'filters':[{'field':'id','op':'eq','value':'old-link'}]}
        proposal=propose('admin','bookmarks',operation)
        query_collection('admin','bookmarks',{**operation,'values':{'title':'Newer'}})
        with self.assertRaises(ValueError): decide('admin',proposal['proposal_id'],True)
        self.assertEqual(query_collection('admin','bookmarks',{'single':'required'})['title'],'Newer')

    def test_exact_reminder_minute_and_relative_reminder(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from services.productivity_reminders import reminder_stage
        now=datetime(2026,10,8,9,37,30,tzinfo=ZoneInfo('Africa/Cairo'))
        item={'date':'2026-10-08','time':'10:00','reminder_time':'09:37','notify_minutes':10,'done':False}
        self.assertEqual(reminder_stage(item,now),'reminder')
        item['reminder_time']='09:38'
        self.assertIsNone(reminder_stage(item,now))
        item['reminder_time']=None;item['time']='09:40'
        self.assertEqual(reminder_stage(item,now),'soon')
        item['done']=True
        self.assertIsNone(reminder_stage(item,now))

    def test_scripts_require_human_admin_and_source_review(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routes.productivity_script_routes import router
        from core.middleware import INTERNAL_TOOL_HEADER, INTERNAL_TOOL_TOKEN
        app=FastAPI()
        class Manager:
            def is_admin(self,owner):return owner=='admin'
        app.state.auth_manager=Manager()
        @app.middleware('http')
        async def identity(request,next_handler):
            request.state.current_user=request.headers.get('x-test-owner')
            return await next_handler(request)
        app.include_router(router)
        client=TestClient(app)
        self.assertEqual(client.post('/api/productivity-scripts/run',json={}).status_code,401)
        self.assertEqual(client.post('/api/productivity-scripts/run',headers={'x-test-owner':'viewer','origin':'http://testserver'},json={}).status_code,403)
        self.assertEqual(client.post('/api/productivity-scripts/run',headers={'x-test-owner':'admin',INTERNAL_TOOL_HEADER:INTERNAL_TOOL_TOKEN,'origin':'http://testserver'},json={}).status_code,403)
        self.assertEqual(client.post('/api/productivity-scripts/run',headers={'x-test-owner':'admin','origin':'http://hostile.example'},json={}).status_code,403)

    def test_connected_assistant_identity_is_bound_to_session(self):
        from core.database import SessionLocal,Session,CrewMember
        from services.hephastos import is_linked_assistant,ASSISTANT_TOOLS
        with SessionLocal.begin() as db:
            if not db.get(Session,'assistant-test'):
                db.add(Session(id='assistant-test',name='Assistant',owner='admin',endpoint_url='http://127.0.0.1',model='test'))
                db.flush()
                db.add(CrewMember(id='assistant-crew-test',owner='admin',name='Assistant',session_id='assistant-test',is_default_assistant=True))
        with patch.dict(os.environ,{'HEPHASTOS_WORKSPACE_OWNER':'admin'}):
            self.assertTrue(is_linked_assistant('admin','assistant-test'))
            with self.assertRaises(PermissionError):is_linked_assistant(None,'assistant-test')
            self.assertFalse(is_linked_assistant('admin','coding-session'))
        self.assertTrue({'bash','python','host_shell','app_api','api_call','send_to_session','manage_tasks','manage_bg_jobs'}.isdisjoint(ASSISTANT_TOOLS))


if __name__ == "__main__": unittest.main()
