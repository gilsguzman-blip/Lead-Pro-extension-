# Parse leadpro_full_prompt_*.txt captures into caps.json + catalog.json.
# Usage: python3 parse.py <captures dir> <out dir>   (captures hold customer data: never commit them or the outputs)
import re, glob, json, os, collections
import sys
UP=(sys.argv[1] if len(sys.argv)>1 else '.').rstrip('/')+'/'
OUT=(sys.argv[2] if len(sys.argv)>2 else '.').rstrip('/')+'/'
def parse(path):
    t=open(path,encoding='utf-8',errors='replace').read()
    ui=t.find('=== USER PROMPT'); sysp=t[:ui]; user=t[t.find('\n',ui)+1:] if ui>=0 else ''
    lines=user.split('\n')
    # transcript block
    tr_start=next((i for i,l in enumerate(lines) if l.startswith('CONVERSATION TRANSCRIPT')),None)
    tr=[];scaffold=[];arc=[]
    in_tr=False;dash=0
    for i,l in enumerate(lines):
        if tr_start is not None and i==tr_start: in_tr=True; continue
        if in_tr:
            if l.strip()=='---':
                dash+=1
                if dash==2: in_tr=False
                continue
            tr.append(l); continue
        if re.match(r'^\d+\.\s*\[\d',l): arc.append(l); continue
        scaffold.append(l)
    # transcript entries
    entries=[];cur=None
    for l in tr:
        m=re.match(r'^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$',l)
        if m:
            cur={'date':m.group(1),'tag':m.group(2).strip(),'title':m.group(3),'body':''}; entries.append(cur)
        elif l.startswith('[CUSTOMER REQUEST FROM INQUIRY]'):
            cur={'date':'','tag':'INQUIRY','title':'','body':l[len('[CUSTOMER REQUEST FROM INQUIRY]'):].strip()}; entries.append(cur)
        elif cur is not None:
            cur['body']+=(' ' if cur['body'] else '')+l.strip()
    # stop at marker: entries above marker = current lead
    cur_lead=[];seen_marker=False
    for e in entries:
        if 'CURRENT LEAD SUBMITTED' in e['tag']: seen_marker=True; continue
        e['current']=not seen_marker
    store=(re.search(r'^Store:\s+(.*)$',user,re.M) or [None,''])[1]
    return {'id':os.path.basename(path)[:8],'file':os.path.basename(path),'store':store.strip(),'sys':sysp,'user':user,'scaffold':scaffold,'arc':arc,'entries':entries}
caps=[parse(p) for p in sorted(glob.glob(UP+'*full_prompt*'))]
json.dump(caps,open(OUT+'caps.json','w'))
# directive catalog: normalize scaffold lines
def norm(l):
    l=l.strip()
    l=re.sub(r'"[^"]{0,400}"','"…"',l); l=re.sub(r'“[^”]{0,400}”','"…"',l)
    l=re.sub(r'\d','N',l)
    return l[:70]
cnt=collections.Counter(); ex={}
for c in caps:
    seen=set()
    for l in c['scaffold']:
        if len(l.strip())<12: continue
        k=norm(l)
        if k in seen: continue
        seen.add(k); cnt[k]+=1; ex.setdefault(k,c['id'])
N=len(caps)
cond=[(k,v) for k,v in cnt.items() if v<N*0.9]
print('captures',N,'distinct scaffold lines',len(cnt),'conditional',len(cond))
json.dump({'cnt':cnt,'ex':ex},open(OUT+'catalog.json','w'))
