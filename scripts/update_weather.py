#!/usr/bin/env python3
import json,datetime,pathlib,urllib.request
url='https://api.open-meteo.com/v1/forecast?latitude=46.948&longitude=7.447&timezone=Europe%2FZurich&forecast_days=4&current=temperature_2m,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,dew_point_2m,precipitation,snowfall,weather_code,freezing_level_height'
with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'WinterdienstBern/1.0'}),timeout=30) as r:data=json.load(r)
h=data.get('hourly',{})
assert len(h.get('time',[]))>=72 and len(h.get('temperature_2m',[]))==len(h['time']), 'Unvollständige Daten'
result={'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'Open-Meteo','data':data}
pathlib.Path('weather-data.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
print('Aktualisiert:',result['fetched_at'])
