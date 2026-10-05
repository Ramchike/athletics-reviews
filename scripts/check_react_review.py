#!/usr/bin/env python3
import argparse
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Browser checks of the published React training review.')
parser.add_argument('--base-url',required=True,help='Site URL including /athletics-reviews/')
parser.add_argument('--chromium',help='Optional Chromium executable; otherwise use Playwright installed browser.')
parser.add_argument('--screenshots',type=Path,help='Optional local screenshot directory; keep it out of publication.')
options=parser.parse_args()
BASE=options.base_url.rstrip('/')+'/'
if options.screenshots:options.screenshots.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=options.chromium,args=['--no-sandbox'])
  for width in (360,390,1280):
   page=await browser.new_page(viewport={'width':width,'height':844});errors=[]
   page.on('pageerror',lambda error:errors.append(str(error)))
   await page.goto(BASE+'starts/')
   await page.get_by_role('button',name='Рамир',exact=True).click()
   assert 'athlete=ramir' in page.url
   assert await page.locator('[data-review-person="ramir"]').count()==7
   assert await page.locator('[data-review-person="misha"]').count()==0
   assert not await page.locator('[data-card="white-start"]').count()
   ramir_images=await page.locator('[data-review-person] img').evaluate_all('(imgs)=>imgs.map(i=>i.src)')
   assert all('white-' not in url for url in ramir_images)
   await page.get_by_role('button',name='Миша',exact=True).click()
   assert await page.locator('[data-review-person="misha"]').count()==7
   assert await page.locator('[data-review-person="ramir"]').count()==0
   assert not await page.locator('[data-card="red-start"]').count()
   await page.reload();await page.locator('[data-review-person="misha"]').first.wait_for()
   assert await page.get_by_role('button',name='Миша',exact=True).get_attribute('aria-pressed')=='true'
   await page.get_by_role('button',name='Рамир',exact=True).click()
   await page.go_back();await page.locator('[data-review-person="misha"]').first.wait_for()
   assert await page.locator('[data-review-person="ramir"]').count()==0
   await page.get_by_role('button',name='У стены',exact=True).click()
   assert await page.locator('[data-card]').count()==3
   await page.get_by_placeholder('Например: спина, колено, стопа').fill('zzzzzz')
   assert await page.get_by_text('Такого совета пока нет').is_visible()
   await page.get_by_role('button',name='Сбросить поиск',exact=True).click()
   assert await page.locator('[data-card]').count()==7
   for summary in await page.locator('article details summary').all():await summary.click()
   for motion in await page.get_by_role('button',name='Посмотреть движение',exact=True).all():await motion.click()
   images=await page.locator('main img').all()
   for img in images:
    await img.scroll_into_view_if_needed();await img.evaluate('(i)=>i.decode()')
    box=await img.bounding_box();assert box['width']>150 and box['height']>50
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   if width==390 and options.screenshots:
    await page.locator('[data-card="white-start"]').scroll_into_view_if_needed()
    await page.screenshot(path=str(options.screenshots/'react-misha.png'))
   await page.goto(BASE+'skills/')
   await page.locator('[data-skill]').first.wait_for()
   assert await page.locator('[data-skill]').count()==8
   await page.get_by_role('button',name='Готовые 2',exact=True).click();assert await page.locator('[data-skill]').count()==2
   await page.get_by_role('button',name='Местные 6',exact=True).click();assert await page.locator('[data-skill]').count()==6
   await page.get_by_role('button',name='Все 8',exact=True).click()
   await page.locator('[data-skill="sprint-video-review"] summary').first.click()
   assert await page.get_by_text('Видео старта и ускорения',exact=True).is_visible()
   assert all('/.agents/skills/' in href for href in await page.locator('a').evaluate_all("(links)=>links.filter(a=>a.textContent.includes('Файл SKILL.md')).map(a=>a.href)"))
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   if width==390 and options.screenshots:
    await page.locator('[data-skill="scientific-literature-review"]').scroll_into_view_if_needed();await page.screenshot(path=str(options.screenshots/'react-skills.png'))
   for route in ['','plan','exercises','map','research','learning','tasks']:
    await page.goto(BASE+route+('/' if route else '')+'?athlete=ramir')
    await page.locator('main h1').first.wait_for()
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'),route
    if route=='map':assert await page.locator('[data-map-person="misha"]').count()==0
    if route=='research':assert await page.get_by_text('10–20 советских фильмов пока не просмотрены.',exact=True).is_visible()
    if route=='tasks':assert await page.locator('.task-card').count()==15
    if route=='' and options.screenshots:
     await page.screenshot(path=str(options.screenshots/f'react-home-{width}.png'))
    if route=='':
     await page.emulate_media(reduced_motion='reduce')
     assert await page.locator('.sketch-scan').evaluate("e=>getComputedStyle(e).animationName")=='none'
     await page.emulate_media(reduced_motion='no-preference')
   assert not errors,errors
   print(f'{width}px: strict athlete filters, URL/reload/back, exercise/search, {len(images)} images, 8 skills, 9 routes OK')
   await page.close()
  # A broken image must expose a usable link and a clear error, not spin forever.
  page=await browser.new_page(viewport={'width':390,'height':844})
  await page.route('**/red-wall.png',lambda route:route.abort())
  await page.goto(BASE+'starts/?athlete=ramir&exercise=wall')
  broken=page.locator('.photo-surface.is-error').first
  await broken.scroll_into_view_if_needed()
  assert await broken.get_by_text('Кадр не загрузился. Нажмите, чтобы открыть файл.').is_visible()
  assert await broken.get_attribute('href')
  await page.close()
  print('Reduced motion and image failure states OK')
  await browser.close()
asyncio.run(main())
