# Usage: python3 quotes.py <out dir from parse.py>
import json,re,collections,sys,os
OUT=(sys.argv[1] if len(sys.argv)>1 else '.')
caps=json.load(open(os.path.join(OUT,'caps.json')))
def n(s): return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
# directive kinds that attribute text to the customer, keyed by a phrase in the line
KINDS=[('OPEN QUESTION (digest)',r'^\s*"'),  # the quoted line under OPEN QUESTION FROM CUSTOMER
 ('OPEN THREADS: customer asked',r'Customer asked question'),('OPEN THREADS: customer said they would',r'Customer said they would'),
 ('OPEN THREADS: agent committed',r'Agent committed'),('RECURRING TOPICS',r'has come up \d+ time'),('PERSONAL CONTEXT',r'^\s*- \[(?:lifeEvent|priorVehicle|geographic|family|occupation)'),
 ('MOST RECENT CUSTOMER MESSAGE',r'MOST RECENT CUSTOMER MESSAGE'),('CONVERSATION STATE',r'CONVERSATION STATE: The customer'),
 ("CUSTOMER'S INQUIRY",r'^"'),('VERBALLY CONFIRMED',r'verbally confirmed'),('FRICTION quote',r'FRICTION|stated a specific budget'),
 ('CUSTOMER NAMED A DAY',r'Customer said \w+ is when'),('DECLINED ALTERNATIVE',r'DECLINED ALTERNATIVE'),
 ('BUDGET/NUMBER',r'(?i)their stated number|stated a specific')]
res=collections.defaultdict(lambda: collections.Counter()); bad=collections.defaultdict(list)
for c in caps:
    ents=[(e['tag'],n(e['title']+' '+e['body'])) for e in c['entries']]
    arc=[n(a) for a in c['arc']]
    prev=''
    for l in c['scaffold']:
        kind=None
        for k,rx in KINDS:
            if re.search(rx,l):
                kind=k; break
        if kind=='OPEN QUESTION (digest)' and 'OPEN QUESTION FROM CUSTOMER' not in prev: kind=None
        if kind=="CUSTOMER'S INQUIRY" and "CUSTOMER'S INQUIRY" not in prev: kind=None
        prev=l
        if not kind: continue
        qs=[q for q in re.findall(r'"([^"]{8,400})"|“([^”]{8,400})”',l) for q in q if q]
        for q in qs:
            nq=n(q)[:120]
            if len(nq)<8: continue
            tags=sorted(set(t for t,b in ents if nq in b))
            if not tags:
                src='ARC-ONLY' if any(nq in a for a in arc) else 'NOT IN TRANSCRIPT'
            elif 'CUSTOMER' in tags or 'INQUIRY' in tags: src='CUSTOMER'
            else: src='/'.join(tags)
            res[kind][src]+=1
            if src!='CUSTOMER' and kind!='OPEN THREADS: agent committed':
                bad[kind].append((c['id'],src,q[:90]))
            if kind=='OPEN THREADS: agent committed' and src=='CUSTOMER':
                bad[kind].append((c['id'],src,q[:90]))
for k,v in res.items(): print(f'{k:40s}', dict(v))
print()
for k,v in bad.items():
    print('==',k,len(v))
    for x in v[:12]: print('   ',x)
