"""Verify separate Good-Writers pairing and result processing."""
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

import good_writers_reporting as gw


class Handler:
    def __init__(self):
        self.auth=True;self.csrf=True;self.headers={};self.body={};self.response=None
    def admin_session(self):
        return {'id':1} if self.auth else None
    def admin_write_authorized(self):
        return self.csrf
    def json_body(self):
        return self.body
    def send_json(self,status,data):
        self.response=(status,data)
        return self.response


class GoodWritersReportingTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.path=Path(self.folder.name)/'test.sqlite3'
        self.handler=Handler()
    def tearDown(self):
        self.folder.cleanup()
    @contextmanager
    def database(self):
        db=sqlite3.connect(self.path)
        db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def test_pair_verify_event_dedupe_revoke(self):
        status,data=gw.pair(self.handler,self.database)
        self.assertEqual(status,200)
        token=data['pairingCode']
        self.handler.headers={'Authorization':'Bearer '+token}
        self.assertEqual(gw.verify(self.handler,self.database)[0],200)
        self.handler.body={'eventKey':'claim_123456789_1800000000000',
            'orderId':'123456789','outcome':'success','stage':'result',
            'elapsedMs':1900,'detail':'Now you can write the order'}
        self.assertEqual(gw.receive(self.handler,self.database)[0],202)
        self.assertEqual(gw.receive(self.handler,self.database)[0],202)
        self.assertEqual(len(gw.events(self.handler,self.database)[1]['events']),1)
        self.assertEqual(gw.events(self.handler,self.database)[1]['events'][0]['orderId'],'123456789')
        self.assertEqual(gw.revoke(self.handler,self.database)[0],200)
        self.handler.response=None
        gw.receive(self.handler,self.database)
        self.assertEqual(self.handler.response[0],401)

    def test_authentication_and_invalid_report(self):
        self.handler.auth=False
        gw.pair(self.handler,self.database)
        self.assertEqual(self.handler.response[0],401)
        self.handler.auth=True
        self.handler.csrf=False
        gw.pair(self.handler,self.database)
        self.assertEqual(self.handler.response[0],403)
        self.handler.csrf=True
        token=gw.pair(self.handler,self.database)[1]['pairingCode']
        self.handler.headers={'Authorization':'Bearer '+token}
        self.handler.body={'eventKey':'invalid'}
        self.assertEqual(gw.receive(self.handler,self.database)[0],400)
        self.handler.headers={'Authorization':'Bearer invalid'}
        gw.verify(self.handler,self.database)
        self.assertEqual(self.handler.response[0],401)

if __name__=='__main__':
    unittest.main()
