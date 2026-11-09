"""Regression checks: multiple safe attachments and legacy single-file callers."""
import base64, json, unittest, uuid
from unittest.mock import patch
import admin_document_sender as docs

class MultipleDocumentsTests(unittest.TestCase):
 def base(self,files):
  return {'recipient':'client@example.org','subject':'Two documents','message':'See attached.',
          'attachments':[{'filename':n,'contentBase64':base64.b64encode(blob).decode()} for n,blob in files],
          'requestId':str(uuid.uuid4()),'confirmed':True}
 def test_validate_two_documents_and_send_in_one_email(self):
  data=docs.validate_document(self.base([('one.pdf',b'%PDF-1.4\nhello'),('two.txt',b'World')]))
  self.assertEqual(len(data['attachments']),2)
  self.assertIn('one.pdf',data['filename'])
  self.assertIn('two.txt',data['filename'])
  class Reply:
   status=200
   def __enter__(self):return self
   def __exit__(self,*a):return False
   def read(self,*a):return b'{"id":"email-multi-123"}'
  with patch.dict('os.environ',{'RESEND_API_KEY':'test-secret','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}),patch.object(docs,'urlopen',return_value=Reply()) as mock:
   self.assertEqual(docs.send_via_resend(data),'email-multi-123')
  body=json.loads(mock.call_args.args[0].data)
  self.assertEqual([f['filename'] for f in body['attachments']],['one.pdf','two.txt'])
  self.assertEqual(base64.b64decode(body['attachments'][1]['content']),b'World')
 def test_more_than_five_rejected(self):
  with self.assertRaisesRegex(ValueError,'five'):
   docs.validate_document(self.base([(f'doc{i}.txt',b'hello') for i in range(6)]))
 def test_total_limit_rejected(self):
  data=self.base([('first.txt',b'a'*6_000_000),('second.txt',b'b'*6_000_000),('third.txt',b'c'*5_000_000)])
  with self.assertRaisesRegex(ValueError,'15 MB'):
   docs.validate_document(data)
 def test_single_file_legacy_supported(self):
  old=self.base([('one.pdf',b'%PDF-1.4\nhello')]); single=old.pop('attachments')[0]
  old['filename']=single['filename'];old['fileBase64']=single['contentBase64']
  self.assertEqual(len(docs.validate_document(old)['attachments']),1)
 def test_file_type_and_bad_magic_are_rejected(self):
  for entry in [[('exploit.exe',b'bad')],[('wrong.pdf',b'not a pdf')]]:
   with self.assertRaises(ValueError):docs.validate_document(self.base(entry))
if __name__=='__main__':unittest.main()
