# Extract title, JSON-LD and visible text from saved tmz.it pages (curl -o <dir>/<path_with_underscores>.html)
# Usage: python3 scripts/catalogue/extract-public-baseline.py <dir> > after.json ; then diff against reports/r1-public-baseline-live-2026-11-02.json
import re,json,sys,glob,html
out={}
for f in sorted(glob.glob((sys.argv[1] if len(sys.argv)>1 else '.') + '/*.html')):
    s=open(f,encoding='utf-8',errors='replace').read()
    name=f.split('/')[-1][:-5]
    if name.endswith('.txt') or name.endswith('.xml'):
        out[name]={'raw':s}; continue
    ld=[json.loads(x) for x in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>',s,re.S)]
    body=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S)
    text=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',body))).strip()
    title=re.search(r'<title>(.*?)</title>',s,re.S)
    out[name]={'title':html.unescape(title.group(1)) if title else None,'jsonld':ld,'text':text}
json.dump(out,sys.stdout,ensure_ascii=False,indent=1)
