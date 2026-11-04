"""Optional Prowell transactional email and SMS provider adapters. No external pip packages."""
import base64
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def email_configured():
    return bool(os.getenv('RESEND_API_KEY') and os.getenv('NOTIFY_FROM_EMAIL'))


def sms_configured():
    return bool(os.getenv('TWILIO_ACCOUNT_SID') and os.getenv('TWILIO_AUTH_TOKEN') and
                (os.getenv('TWILIO_FROM_NUMBER') or os.getenv('TWILIO_MESSAGING_SERVICE_SID')))


def send_notification(channel, recipient, subject, body, idempotency_key):
    """Send one notice; caller handles retries. Never log secrets or provider response bodies."""
    if channel == 'email':
        if not email_configured():
            raise RuntimeError('Email provider is not configured')
        sender=os.environ['NOTIFY_FROM_EMAIL']
        data=json.dumps({'from':f'Prowell Jobs <{sender}>','to':[recipient],
                         'subject':subject,'text':body,'reply_to':['prowellofficial@gmail.com']}).encode()
        request=Request('https://api.resend.com/emails',data=data,method='POST',headers={
            'Authorization':'Bearer '+os.environ['RESEND_API_KEY'],
            'Content-Type':'application/json','Idempotency-Key':idempotency_key[:256]})
    elif channel == 'sms':
        if not sms_configured():
            raise RuntimeError('SMS provider is not configured')
        sid=os.environ['TWILIO_ACCOUNT_SID']
        params={'To':recipient,'Body':body[:500]}
        if os.getenv('TWILIO_MESSAGING_SERVICE_SID'):
            params['MessagingServiceSid']=os.environ['TWILIO_MESSAGING_SERVICE_SID']
        else:
            params['From']=os.environ['TWILIO_FROM_NUMBER']
        auth=base64.b64encode((sid+':'+os.environ['TWILIO_AUTH_TOKEN']).encode()).decode('ascii')
        request=Request(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
                        data=urlencode(params).encode(),method='POST',headers={
                            'Authorization':'Basic '+auth,
                            'Content-Type':'application/x-www-form-urlencoded'})
    else:
        raise ValueError('Unsupported notification channel')
    with urlopen(request,timeout=8) as reply:
        if not 200 <= reply.status < 300:
            raise RuntimeError('Provider returned non-success status')
