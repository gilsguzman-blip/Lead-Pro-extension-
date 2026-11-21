# Usage: python3 evidence.py <out dir from parse.py>
import json,re,collections,sys,os,datetime
OUT=(sys.argv[1] if len(sys.argv)>1 else '.')
caps=json.load(open(os.path.join(OUT,'caps.json')))
def when(s):
    for f in ('%m/%d/%Y %I:%M %p','%m/%d/%Y'):
        try: return datetime.datetime.strptime(s.strip(),f)
        except: pass
    return None
out=collections.defaultdict(list)
for c in caps:
    U=c['user']; ents=c['entries']
    cur=[e for e in ents if e.get('current',True) and e['tag'] not in ('INQUIRY',) and 'CURRENT LEAD' not in e['tag']]
    cust=[e for e in cur if e['tag']=='CUSTOMER']
    custtxt=' '.join(e['body'] for e in cust).lower()
    alltxt=' '.join(e['title']+' '+e['body'] for e in ents).lower()
    notes=' '.join(e['title']+' '+e['body'] for e in ents if e['tag'] in ('NOTE','CALL NOTE')).lower()
    m=re.search(r'CURRENT TIME: (\d+:\d+ [AP]M) Central on TODAY \(\w+ (\d+/\d+)\)',U); now=None
    if m: now=datetime.datetime.strptime('2026/'+m.group(2)+' '+m.group(1),'%Y/%m/%d %I:%M %p')
    lastc=max([when(e['date']) for e in cust if when(e['date'])] or [None], default=None) if cust else None
    def add(k,verdict,note): out[k].append((c['id'],verdict,note))
    if '🔴 TRADE-IN FLAG' in U:
        on_file='🔄 TRADE-IN:' in U
        said=bool(re.search(r'\btrade|trading|what.*(give|get) (me )?for|payoff|owe on',custtxt))
        add('TRADE-IN FLAG','OK' if (on_file or said) else 'UNSUPPORTED', f'onFile:{on_file} customerMentions:{said}')
    if '🔒 SENSITIVE FINANCE RULE' in U:
        # the shipped pattern (popup.js _lpSensFin), over the whole thread
        rx=r'\b[3-8]\d{2}\s*(?:credit|fico|beacon)\b|\b(?:credit\s*score|fico|beacon)\b[^\n]{0,24}\b[3-8]\d{2}\b|upside[\s-]?down|negative\s+equity|under\s?water'
        hit=re.search('.{0,40}(?:'+rx+').{0,40}',alltxt)
        add('SENSITIVE FINANCE RULE','OK' if hit else 'CHECK', (hit.group(0) if hit else 'pattern not found in the thread')[:110])
    if '🔥 LIVE CONVERSATION' in U:
        age=(now-lastc).total_seconds()/3600 if (now and lastc) else None
        add('LIVE CONVERSATION','OK' if age is not None and age<=12 else 'UNSUPPORTED', f'lastCustomerMsgHoursAgo:{None if age is None else round(age,1)}')
    if re.search(r'ZERO CUSTOMER RESPONSE|The customer has never replied to anything on this lead',U):
        add('NEVER REPLIED','OK' if not cust else 'UNSUPPORTED', f'customerEntriesOnLead:{len(cust)}')
    if re.search(r'ONE-SIDED CONVERSATION',U):
        add('ONE-SIDED','OK' if not cust else 'CHECK', f'customerEntriesOnLead:{len(cust)}')
    if re.search(r'PAUSE SIGNAL|CUSTOMER NEEDS SPACE|TASK: Customer is not ready',U):
        hit=re.search(r".{0,40}(not ready|need (more )?time|hold off|not right now|think about|few (days|weeks)|later|busy|not interested|family|health).{0,40}",custtxt)
        add('PAUSE / NEEDS SPACE','OK' if hit else 'CHECK',(hit.group(0) if hit else 'no pause phrase in customer text')[:100])
    if re.search(r'NOT TODAY: Customer said today',U):
        hit=re.search(r".{0,40}(not today|can'?t today|cannot today|today (doesn'?t|does not|won'?t)|tomorrow|another day|this weekend|off work).{0,40}",custtxt)
        add('NOT TODAY','OK' if hit else 'CHECK',(hit.group(0) if hit else 'none')[:100])
    m2=re.search(r'VEHICLE PIVOT DETECTED: Customer is now asking about a (\w+)',U)
    if m2:
        add('VEHICLE PIVOT','OK' if m2.group(1).lower() in custtxt else 'UNSUPPORTED', f'model:{m2.group(1)} inCustomerText:{m2.group(1).lower() in custtxt}')
    m3=re.search(r'CROSS-BRAND PIVOT: Customer is now interested in a (\S+)',U)
    if m3:
        k=m3.group(1).lower().replace('-','')
        add('CROSS-BRAND PIVOT','OK' if k in custtxt.replace('-','') else 'UNSUPPORTED', f'model:{m3.group(1)} inCustomerText:{k in custtxt.replace("-","")}')
    if '🔴 VEHICLE STATUS: SOLD' in U or 'SOLD → INCENTIVE PIVOT' in U or re.search(r'SITUATION: The vehicle they inquired about has sold',U):
        inv_not='NOT confirmed available' in U
        noted=bool(re.search(r'\bsold\b|no longer available|not available|deposit',alltxt))
        add('VEHICLE SOLD','OK' if (inv_not and noted) else 'CHECK', f'inventoryNotConfirmed:{inv_not} soldWordInThread:{noted}')
    if 'VEHICLE VARIANT MISMATCH' in U:
        mm=re.search(r'VEHICLE VARIANT MISMATCH:[^\n]{0,260}',U); add('VARIANT MISMATCH','CHECK',mm.group(0)[:200] if mm else '')
    if 'TWO DIFFERENT VEHICLES ARE ON THIS LEAD' in U: add('TWO VEHICLES','CHECK','')
    if '⚠ VISIT OVERRIDE' in U:
        v=[e for e in ents if 'SHOWROOM' in e['tag'] or 'visit' in (e['title']+e['body']).lower()]
        add('VISIT OVERRIDE','CHECK',f'visitEntries:{len(v)}')
    if re.search(r'TIMELINE: Customer is not in a rush',U):
        hit=re.search(r".{0,40}(not in a rush|no hurry|whenever|eventually|down the road|next month|few months|next year|not right now|not urgent).{0,40}",custtxt)
        add('TIMELINE not in a rush','OK' if hit else 'UNSUPPORTED',(hit.group(0) if hit else 'none in customer text')[:100])
    if 'FINANCING CONCERN' in U:
        hit=re.search(r".{0,40}(\bcredit\b|financ|pre.?approv|interest rate|down payment|how much down).{0,40}",custtxt)
        add('FINANCING CONCERN','OK' if hit else 'UNSUPPORTED',(hit.group(0) if hit else 'none in customer text')[:100])
    if 'PRICE/PAYMENT CONCERN' in U:
        hit=re.search(r".{0,40}(too (much|high|expensive)|afford|budget|price|payment|cost|how much|out the door|otd).{0,40}",custtxt)
        add('PRICE/PAYMENT CONCERN','OK' if hit else 'UNSUPPORTED',(hit.group(0) if hit else 'none in customer text')[:100])
    for mm in re.finditer(r'COLOR PREFERENCE: Customer mentioned (\w+)',U):
        add('COLOR PREFERENCE','OK' if mm.group(1).lower() in custtxt else 'UNSUPPORTED',f'{mm.group(1)} inCustomerText:{mm.group(1).lower() in custtxt}')
    for mm in re.finditer(r'TRIM/CONFIG PREFERENCE: Customer referenced ([\w-]+)',U):
        t=mm.group(1).lower(); add('TRIM/CONFIG PREFERENCE','OK' if re.search(r'\b'+re.escape(t)+r'\b',custtxt) else 'UNSUPPORTED',f'{mm.group(1)} inCustomerText:{bool(re.search(chr(92)+"b"+re.escape(t)+chr(92)+"b",custtxt))}')
    if 'stated a specific budget, payment, or OTD target' in U:
        hit=re.search(r".{0,40}(\$\s?\d[\d,]*|\d{2,3},\d{3}|\d+k\b|/mo|a month|per month).{0,40}",custtxt)
        add('BUDGET STATED','OK' if hit else 'UNSUPPORTED',(hit.group(0) if hit else 'no figure in customer text')[:100])
    if '⚠ TRADE DISCUSSED, BUT NO TRADE VEHICLE' in U:
        named='customer HAS described their trade' in U
        add('TRADE DISCUSSED guard','CHECK',f'saysCustomerDescribedTrade:{named}')
    if 'CUSTOMER NAMED A SPECIFIC DAY' in U:
        mm=re.search(r'Customer said (\w+) is when',U); d=mm.group(1).lower() if mm else ''
        add('CUSTOMER NAMED A DAY','OK' if d and d in custtxt else 'UNSUPPORTED',f'{d} inCustomerText:{d in custtxt}')
json.dump(out,open(os.path.join(OUT,'evidence.json'),'w'),indent=1)
for k,v in sorted(out.items(),key=lambda kv:-len(kv[1])):
    cnt=collections.Counter(x[1] for x in v)
    print(f'{k:26s} fired:{len(v):3d}  '+'  '.join(f'{a}:{b}' for a,b in cnt.items()))
    for x in v:
        if x[1]!='OK': print('      ',x)
