"""Offline tests for owner-paired browser extension result notifications."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

import admin_extension_store as store


class FakeHandler:
    def __init__(self):
        self.headers={}
        self.response=None
        self.authorized=True
        self.csrf=True
        self.payload={}
    def admin_session(self): return {'authenticated':True} if self.authorized else None
    def admin_write_authorized(self): return self.csrf and self.authorized
    def json_body(self): return self.payload
    def send_json(self,code,data):
        self.response=(code,data)
        return self.response


class ExtensionReportingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'temporary.sqlite3'
        self.handler=FakeHandler()
    def tearDown(self):
        self.temp.cleanup()

    @contextmanager
    def database(self):
        db=sqlite3.connect(self.path)
        db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally:
            db.close()

    def pair(self):
        code,result=store.create_report_token(self.handler,self.database)
        self.assertEqual(code,200,result)
        return result['pairingCode']

    def test_private_pairing_reports_and_revocation(self):
        secret=self.pair()
        self.handler.headers={'Authorization':'Bearer '+secret}
        self.handler.payload={
            'eventKey':'claim_6447728953_1800000000000',
            'orderId':'6447728953','outcome':'success','stage':'result',
            'elapsedMs':1900,'detail':'Now you can write the order'
        }
        status,data=store.receive_report(self.handler,self.database)
        self.assertEqual(status,202,data)
        # Sending the same result twice must not duplicate notifications.
        store.receive_report(self.handler,self.database)
        _,records=store.list_report_events(self.handler,self.database)
        self.assertEqual(len(records['events']),1)
        self.assertEqual(records['events'][0]['outcome'],'success')
        self.assertEqual(records['events'][0]['elapsedMs'],1900)
        store.revoke_report_token(self.handler,self.database)
        status,_=store.receive_report(self.handler,self.database)
        self.assertEqual(status,401)

    def test_unpaired_and_malformed_requests_are_rejected(self):
        self.handler.authorized=False
        code,_=store.list_report_events(self.handler,self.database)
        self.assertEqual(code,401)
        self.handler.authorized=True
        secret=self.pair()
        self.handler.headers={'Authorization':'Bearer '+secret}
        self.handler.payload={'eventKey':'invalid'}
        status,_=store.receive_report(self.handler,self.database)
        self.assertEqual(status,400)
        self.handler.headers={'Authorization':'Bearer incorrect'}
        status,_=store.receive_report(self.handler,self.database)
        self.assertEqual(status,401)

    def test_csrf_required_for_pairing(self):
        self.handler.csrf=False
        code,_=store.create_report_token(self.handler,self.database)
        self.assertEqual(code,403)


if __name__=='__main__':
    unittest.main()
