#!/usr/bin/env python3
"""Phone navigation, explanation coverage, owned replay and programme checks."""
import argparse,asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--chromium',required=True);parser.add_argument('--screenshots',type=Path);args=parser.parse_args()
BASE=args.base_url.rstrip('/')+'/'
program=json.loads((Path(__file__).resolve().parents[1]/'plans/two-hour-session.json').read_text())
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=args.chromium,args=['--no-sandbox'])
  for width in [360,390,1280]:
   page=await browser.new_page(viewport={'width':width,'height':844});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'plan/?athlete=ramir')
   await page.locator('[data-program-block]').first.wait_for()
   assert await page.locator('[data-program-block]').count()==9
   assert await page.locator('[data-readiness="ramir"]').count()==1
   assert await page.locator('[data-volume-person="misha"]').count()==0
   assert await page.locator('[data-roadmap-step]').count()==6
   assert await page.locator('.session-commands li').count()==3
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.locator('[data-program-exercise="wall-march"] a').click()
   await page.locator('[data-exercise-detail="wall-march"]').wait_for()
   assert 'athlete=ramir' in page.url and 'exercise=wall-march' in page.url
   await page.get_by_role('button',name='Миша',exact=True).click()
   assert await page.locator('[data-comparison-person="ramir"]').count()==0
   await page.reload();await page.locator('[data-comparison-person="misha"]').wait_for()
   await page.go_back();await page.locator('[data-comparison-person="ramir"]').wait_for()
   await page.get_by_role('link',name='К полной программе →',exact=True).click()
   assert '#block-wall' in page.url and 'athlete=ramir' in page.url
   await page.goto(BASE+'exercises/?athlete=misha&exercise=a-skip')
   selector=page.get_by_label('Выбрать упражнение',exact=True)
   assert await selector.locator('option').count()==14
   played=set()
   for e in program['exercises']:
    await selector.select_option(e['id'])
    assert await page.locator(f'[data-exercise-detail="{e["id"]}"]').count()==1
    for section in ['why','how','check','stop']:
     assert len(await page.locator(f'[data-explanation="{section}"]').inner_text())>35
    assert await page.locator('[data-comparison-person="ramir"]').count()==0
    assert await page.locator('.sources a').count()>0
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'),(width,e['id'])
    box=await selector.bounding_box();assert box['height']>=44
    video=page.locator('video')
    if await video.count():
     src=await video.locator('source').get_attribute('src')
     if src not in played:
      await video.evaluate('(v)=>{v.muted=true;v.load()}')
      await page.wait_for_function('document.querySelector("video").readyState>=2')
      await video.evaluate('(v)=>v.play()');await page.wait_for_function('document.querySelector("video").currentTime>0')
      await video.evaluate('(v)=>v.pause()');played.add(src)
   await selector.select_option('three-point')
   await page.get_by_role('button',name='Показать авторское видео',exact=False).click()
   embed=await page.locator('iframe').get_attribute('src');assert 'dgewJyq8ZFc' in embed and 'playsinline=1' in embed
   assert await page.get_by_role('link',name='Открыть у автора ↗',exact=True).count()==1
   if width==390 and args.screenshots:
    args.screenshots.mkdir(parents=True,exist_ok=True)
    await page.locator('.video-comparison').scroll_into_view_if_needed();await page.screenshot(path=str(args.screenshots/'programme-misha-video.png'))
   await page.get_by_role('button',name='Рамир',exact=True).click()
   for e in program['exercises']:
    if not e['own']['ramir'].get('video'):continue
    await selector.select_option(e['id']);video=page.locator('video');src=await video.locator('source').get_attribute('src')
    if src not in played:
     await video.evaluate('(v)=>{v.muted=true;v.load()}');await page.wait_for_function('document.querySelector("video").readyState>=2')
     await video.evaluate('(v)=>v.play()');await page.wait_for_function('document.querySelector("video").currentTime>0');await video.evaluate('(v)=>v.pause()');played.add(src)
   assert len(played)==9,len(played)
   assert not errors,errors
   print(f'{width}px: 14 exercises, 9 playable owned videos, programme/person/back/explanation checks passed')
   await page.close()
  await browser.close()
asyncio.run(main())
