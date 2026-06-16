import json, urllib.request, time
from collections import defaultdict
base="https://raw.githubusercontent.com/statsbomb/open-data/master/data"
TOURN=[("FIFA World Cup 2022",43,106),("FIFA World Cup 2018",43,3),
       ("UEFA Euro 2024",55,282),("UEFA Euro 2020",55,43),
       ("Copa America 2024",223,282),("AFCON 2023",1267,107)]
def get(url):
    for _ in range(4):
        try:
            with urllib.request.urlopen(url,timeout=60) as r: return json.load(r)
        except Exception as e:
            time.sleep(2)
    return None
out={}
for name,c,s in TOURN:
    ms=get(f"{base}/matches/{c}/{s}.json")
    if not ms: print("FAIL matches",name); continue
    print(f"{name}: {len(ms)} matches")
    for m in ms:
        mid=m['match_id']; date=m['match_date']
        h=m['home_team']['home_team_name']; a=m['away_team']['away_team_name']
        ev=get(f"{base}/events/{mid}.json")
        if not ev: continue
        xg=defaultdict(float)
        for e in ev:
            if e.get('type',{}).get('name')=='Shot':
                xg[e['team']['name']]+=e.get('shot',{}).get('statsbomb_xg',0) or 0
        out[f"{date}|{h}|{a}"]={"date":date,"home":h,"away":a,
            "homeScore":m.get('home_score'),"awayScore":m.get('away_score'),
            "homeXg":round(xg.get(h,0),3),"awayXg":round(xg.get(a,0),3),"tournament":name}
json.dump(out,open("xg/statsbomb_xg.json","w"),indent=1)
print("TOTAL matches with xG:",len(out))
