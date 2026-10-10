import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from dashboard.core import Store, Settings
from dashboard.ledger import Entry, mutate, snapshot
from dashboard.models import ModelSettings, worker_config
from dashboard.server import create_app


def entry(kind,day=1,**kw):
    return Entry(kind=kind,occurred_at=f'2026-01-{day:02}T09:00:00+08:00',**kw)


def test_average_cost_partial_sales_and_replay(tmp_path):
    s=Store(tmp_path)
    mutate(s,entry('deposit',amount=10000))
    mutate(s,entry('buy',2,ticker='AAPL',quantity=10,price=100,fee=10))
    mutate(s,entry('buy',3,ticker='AAPL',quantity=10,price=120,fee=10))
    sell=entry('sell',4,ticker='AAPL',quantity=5,price=140,fee=5)
    data=mutate(s,sell)
    assert data['positions'][0]['average_price']==111
    assert data['summary']['realized']==140
    assert data['summary']['cash']==8475
    assert data['summary']['unrealized']==435
    assert data['summary']['equity']==10575
    data=mutate(s,delete_id=sell.id)
    assert data['summary']['realized']==0
    assert data['positions'][0]['quantity']==20
    assert data['positions'][0]['last_price']==120
    assert data['summary']['cash']==7780
    assert snapshot(Store(tmp_path))['series']==data['series']


def test_funding_is_not_profit_and_dividend_is_net(tmp_path):
    s=Store(tmp_path)
    mutate(s,entry('deposit',amount=1000))
    mutate(s,entry('withdraw',2,amount=250))
    mutate(s,entry('dividend',3,amount=20,fee=2,ticker='AAPL'))
    data=snapshot(s)
    assert data['summary']['contributed']==750
    assert data['summary']['profit']==18
    assert data['summary']['cash']==768
    assert data['series'][-1]['realized']==18


def test_invalid_rollback_is_atomic(tmp_path):
    s=Store(tmp_path)
    deposit=entry('deposit',amount=1000)
    buy=entry('buy',2,ticker='AMD',quantity=10,price=50)
    mutate(s,deposit);mutate(s,buy)
    sell=entry('sell',3,ticker='AMD',quantity=10,price=60)
    mutate(s,sell)
    before=snapshot(s)
    for e in [buy,deposit]:
        with pytest.raises(ValueError):mutate(s,delete_id=e.id)
        assert snapshot(s)==before
    mutate(s,delete_id=sell.id);mutate(s,delete_id=buy.id);mutate(s,delete_id=deposit.id)
    assert snapshot(s)['summary']['cash']==0
    assert not snapshot(s)['entries']
    assert not s.config()[0].portfolio.positions


def test_backdated_entry_recomputes_later_sales(tmp_path):
    s=Store(tmp_path)
    mutate(s,entry('deposit',amount=10000))
    mutate(s,entry('buy',2,ticker='AMD',quantity=10,price=100))
    mutate(s,entry('sell',5,ticker='AMD',quantity=5,price=150))
    assert snapshot(s)['summary']['realized']==250
    mutate(s,entry('buy',3,ticker='AMD',quantity=10,price=200))
    assert snapshot(s)['summary']['realized']==0
    assert snapshot(s)['positions'][0]['average_price']==150


def test_duplicate_request_never_double_books(tmp_path):
    s=Store(tmp_path);e=entry('deposit',amount=100)
    mutate(s,e);mutate(s,e)
    assert len(snapshot(s)['entries'])==1
    with pytest.raises(ValueError):mutate(s,e.model_copy(update={'note':'different'}))
    mutate(s,delete_id=e.id)
    with pytest.raises(ValueError):mutate(s,e)


def test_schema_migrates_existing_holdings_once_and_creates_backup(tmp_path):
    db=tmp_path/'dashboard.db'
    original=Settings(portfolio={'cash':500,'currency':'HKD','enabled':True,'positions':[{'ticker':'0700.HK','quantity':100,'average_price':400}]})
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE config (id INTEGER PRIMARY KEY,body TEXT,next_due TEXT)')
        c.execute('INSERT INTO config VALUES(1,?,NULL)',(original.model_dump_json(),))
    s=Store(tmp_path)
    data=snapshot(s)
    assert data['summary']['equity']==40500
    assert data['summary']['profit']==0
    assert data['currency']=='HKD'
    assert len(snapshot(Store(tmp_path))['entries'])==2
    assert (tmp_path/'before-ledger-migration.db').exists()


def test_invalid_entries_do_not_modify_state(tmp_path):
    s=Store(tmp_path)
    for kind,kwargs in [('sell',dict(ticker='AAPL',quantity=1,price=100)),('buy',dict(ticker='AAPL',quantity=1,price=100)),('withdraw',dict(amount=1))]:
        with pytest.raises(ValueError):mutate(s,entry(kind,**kwargs))
    assert not snapshot(s)['entries']
    for kw in [{'price':'NaN'},{'quantity':-1},{'occurred_at':'2999-01-01T00:00:00Z'}]:
        with pytest.raises(ValidationError):Entry.model_validate({'kind':'buy','ticker':'AAPL','quantity':1,'price':2,'occurred_at':'2026-01-01T00:00:00Z',**kw})


def test_currency_guard_and_same_time_order(tmp_path):
    s=Store(tmp_path)
    mutate(s,entry('deposit',amount=1000));mutate(s,entry('buy',ticker='AMD',quantity=2,price=100))
    settings=s.config()[0];settings.portfolio.currency='HKD'
    with pytest.raises(ValueError):s.save(settings)
    assert snapshot(s)['summary']['cash']==800


def test_api_persistence_export_and_delete(tmp_path):
    with TestClient(create_app(tmp_path,background=False)) as c:
        c.headers['X-Dashboard-Token']=c.get('/api/state').json()['csrf']
        e=entry('deposit',amount=500)
        assert c.post('/api/portfolio/entries',json=json.loads(e.model_dump_json())).status_code==200
        b=c.get('/api/backup')
        assert b.content.startswith(b'SQLite format 3')
        target=tmp_path/'export.db';target.write_bytes(b.content)
        with sqlite3.connect(target) as check:
            assert check.execute('SELECT count(*) FROM ledger_entries').fetchone()[0]==1
    with TestClient(create_app(tmp_path,background=False)) as c:
        c.headers['X-Dashboard-Token']=c.get('/api/state').json()['csrf']
        assert c.get('/api/portfolio').json()['summary']['cash']==500
        assert c.post(f'/api/portfolio/entries/{e.id}/delete').json()['summary']['cash']==0
        assert c.get('/api/state').json()['settings']['portfolio']['cash']==0
        assert c.get('/api/state').json()['storage']['persistent']


def test_model_config_credentials_and_job_snapshot(tmp_path,monkeypatch):
    import dashboard.server as server
    monkeypatch.setattr(server,'ROOT',tmp_path)
    monkeypatch.delenv('FLUXPORT_LLM_API_KEY',raising=False)
    with TestClient(create_app(tmp_path/'data',background=False)) as c:
        state=c.get('/api/state').json();c.headers['X-Dashboard-Token']=state['csrf']
        state['settings']['models']={'provider':'fluxport','fluxport_model':'gpt-6-sol','fluxport_base_url':'https://api.uselg.top/v1/chat/completions'}
        assert c.post('/api/settings',json=state['settings']).status_code==200
        assert c.post('/api/run',json={'ticker':'AAPL'}).status_code==400
        key='test-fluxport-secret'
        assert c.post('/api/key',json={'provider':'fluxport','key':key}).status_code==200
        response=c.get('/api/state')
        body=response.json()
        assert key not in response.text and body['provider_keys']['fluxport']
        mask=body['provider_key_masks']['fluxport']
        assert mask.startswith(key[:4]) and mask.endswith(key[-4:]) and '•' in mask
        jid=c.post('/api/run',json={'ticker':'AAPL'}).json()['ids'][0]
        state['settings']['models']['provider']='deepseek'
        c.post('/api/settings',json=state['settings'])
        job=c.get(f'/api/job/{jid}').json()
        assert job['settings']['models']['provider']=='fluxport'
        assert job['settings']['models']['fluxport_base_url']=='https://api.uselg.top/v1'
        assert key not in json.dumps(job)


def test_fluxport_maps_to_chat_completions_with_tools(monkeypatch):
    import httpx
    from tradingagents.llm_clients.factory import create_tier_client
    monkeypatch.setenv('FLUXPORT_LLM_API_KEY','Bearer test-flux-key')
    monkeypatch.setenv('OPENAI_COMPATIBLE_API_KEY','wrong-key')
    cfg=worker_config({'llm_provider':'deepseek','quick_think_provider':'deepseek','quick_think_backend_url':'https://api.deepseek.com'}, {'provider':'fluxport'})
    for tier in ['quick','deep']:
        def handler(req):
            assert str(req.url)=='https://api.uselg.top/v1/chat/completions'
            assert req.headers['authorization']=='Bearer test-flux-key'
            payload=json.loads(req.content)
            assert payload['model']=='gpt-6-sol'
            assert payload['tools'][0]['function']['name']=='get_price'
            return httpx.Response(200,json={'id':'chat-test','object':'chat.completion','created':0,'model':'gpt-6-sol','choices':[{'index':0,'message':{'role':'assistant','content':None,'tool_calls':[{'id':'call-1','type':'function','function':{'name':'get_price','arguments':'{"ticker":"AMD"}'}}]},'finish_reason':'tool_calls'}]})
        client=httpx.Client(transport=httpx.MockTransport(handler))
        llm=create_tier_client(cfg,tier,http_client=client).get_llm()
        result=llm.bind_tools([{'type':'function','function':{'name':'get_price','description':'price','parameters':{'type':'object','properties':{'ticker':{'type':'string'}}}}}]).invoke('Test')
        assert result.tool_calls[0]['args']=={'ticker':'AMD'}
    with pytest.raises(ValidationError):ModelSettings(fluxport_base_url='https://secret@api.uselg.top/v1')
    with pytest.raises(ValidationError):ModelSettings(fluxport_model='unsupported')


def test_grsai_maps_to_gemini_chat_completions(monkeypatch):
    import httpx
    from tradingagents.llm_clients.factory import create_tier_client
    monkeypatch.setenv('GRSAI_LLM_API_KEY', 'Bearer test-grsai-key')
    monkeypatch.setenv('OPENAI_COMPATIBLE_API_KEY', 'wrong-key')
    cfg = worker_config(
        {'llm_provider': 'deepseek', 'quick_think_provider': 'deepseek', 'quick_think_backend_url': 'https://api.deepseek.com'},
        {'provider': 'grsai'},
    )
    assert cfg['quick_think_llm'] == 'gemini-3.1-pro'
    assert cfg['backend_url'] == 'https://grsaiapi.com/v1'

    def handler(req):
        assert str(req.url) == 'https://grsaiapi.com/v1/chat/completions'
        assert req.headers['authorization'] == 'Bearer test-grsai-key'
        payload = json.loads(req.content)
        assert payload['model'] == 'gemini-3.1-pro'
        return httpx.Response(
            200,
            json={
                'id': 'chat-test',
                'object': 'chat.completion',
                'created': 0,
                'model': 'gemini-3.1-pro',
                'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'ok'}, 'finish_reason': 'stop'}],
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    llm = create_tier_client(cfg, 'deep', http_client=client).get_llm()
    assert llm.invoke('ping').content == 'ok'
    with pytest.raises(ValidationError):
        ModelSettings(grsai_model='unsupported')
