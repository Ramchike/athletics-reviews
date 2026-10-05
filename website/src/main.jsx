import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import data from './project-data.json';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const ASSETS = `${BASE}reviews/assets/starts-2026-10-04/`;
const GITHUB = 'https://github.com/Ramchike/athletics-reviews';
const people = data.people;
const sections = [['','Главная'],['starts','Разбор'],['plan','Тренировка'],['map','Карта'],['learning','Как учиться'],['skills','Навыки'],['research','Исследования'],['tasks','Все задачи']];
const categories = [['all','Все упражнения'],['start','3-point'],['wall','У стены'],['back','Спина'],['falling','Falling'],['pushup','Push-Up']];
function currentAthlete() { const value = new URLSearchParams(location.search).get('athlete'); return Object.hasOwn(people, value) ? value : 'all'; }
function currentCategory() { const value = new URLSearchParams(location.search).get('exercise'); return categories.some(([id]) => id === value) ? value : 'all'; }
function pageRoute() { return location.pathname.slice(BASE.length).split('/')[0] || ''; }
function appHref(route = '', person = 'all', hash = '') { return `${BASE}${route ? route + '/' : ''}${person !== 'all' ? `?athlete=${person}` : ''}${hash ? '#' + hash : ''}`; }
function docHref(file) { return `${BASE}materials/${file.replace(/\.md(?=#|$)/,'.html')}`; }
function resolveDocLink(href, origin) {
  if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
  return new URL(href.replace(/\.md(?=#|$)/,'.html'),new URL(`${BASE}materials/${origin}`,location.origin)).href;
}
function Markdown({ children, origin='docs/start-research.md' }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: ({node,...props}) => <h2 {...props}/>, a: ({node,...props}) => <a {...props} href={resolveDocLink(props.href,origin)} />, table: ({node,...props}) => <div className="table-wrap"><table {...props}/></div> }}>{children}</ReactMarkdown></div>;
}
function AthletePicker({ person, change }) {
  return <div className="athlete-picker" role="group" aria-label="Выбрать спортсмена">
    {[['all','Оба'],['ramir','Рамир'],['misha','Миша']].map(([id,label]) => <button key={id} className={`athlete-button ${id}`} aria-pressed={person === id} onClick={() => change(id)}><span className="athlete-dot"/>{label}</button>)}
  </div>;
}
function Header({ route, person }) {
  return <header className="site-header"><div className="brand-row"><a className="brand" href={appHref('',person)} aria-label="Рамир и Миша — главная"><span className="brand-mark">↗</span><span>Рамир <b>×</b> Миша</span></a><span className="sport-label">60 / 100 м</span></div><nav className="main-nav" aria-label="Разделы сайта">{sections.map(([id,label]) => <a key={id} href={appHref(id,person)} aria-current={route === id ? 'page' : undefined}>{label}</a>)}</nav></header>;
}
function PageTitle({ eyebrow, title, children }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p className="lead">{children}</p>}</div>; }
function Photo({ photo }) {
  const animation = photo.file.endsWith('.gif');
  const [moving,setMoving] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [failed,setFailed] = useState(false);
  const dims = data.dimensions[photo.file];
  const content = <figure><a className={`photo-surface ${failed?'is-error':loaded?'is-loaded':'is-loading'}`} href={ASSETS + photo.file} target="_blank" rel="noreferrer" aria-label={`Открыть крупно: ${photo.caption}`}><img src={ASSETS + photo.file} alt={photo.caption} loading="lazy" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} width={dims?.[0]} height={dims?.[1]} />{!loaded && <span className="image-loading">{failed ? 'Кадр не загрузился. Нажмите, чтобы открыть файл.' : <>Загрузка кадра<span className="loading-dots">···</span></>}</span>}</a><figcaption>{photo.caption}</figcaption>{photo.full && <a className="text-link" href={ASSETS + photo.full} target="_blank" rel="noreferrer">Открыть кадр со всеми углами ↗</a>}</figure>;
  return animation ? <div className="motion-block"><button className="secondary-button" aria-expanded={moving} onClick={() => setMoving(!moving)}>{moving ? 'Скрыть движение' : 'Посмотреть движение'}</button>{moving && content}</div> : content;
}
function Sources({ sources }) { return <div className="sources"><span>Основания</span>{sources.map(([title,url]) => <a key={url} href={url} target="_blank" rel="noreferrer">{title} ↗</a>)}</div>; }
function MotionSketch() {
  const shape='M338 129 C327 147 310 166 292 179 L238 131 L199 139 L187 181 L200 188 L216 159 L238 164 L287 217 L283 256 L213 284 L164 244 L132 248 L127 266 L165 274 L202 324 Q216 334 235 324 L295 297 L351 334 L372 409 L351 423 L352 437 L399 435 L404 422 L397 406 L385 319 L334 267 L355 194 L386 232 Q397 242 413 232 L457 204 L454 186 L411 205 L380 173 L365 141 Z';
  return <figure className="motion-sketch"><div className="sketch-title"><span>Условная иллюстрация</span><span>START / STUDY</span></div><svg viewBox="0 0 520 470" role="img" aria-label="Условная иллюстрация бегущего человека с сеткой. Не эталон и не измерение спортсмена."><defs><pattern id="blueprint-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0 H0 V25" fill="none" stroke="#779eae" strokeOpacity=".15" strokeWidth=".7"/></pattern><clipPath id="runner-shape"><path d={shape}/><ellipse cx="357" cy="107" rx="29" ry="34" transform="rotate(20 357 107)"/></clipPath><linearGradient id="wire-light" x1="0" x2="1"><stop stopColor="#7facbc"/><stop offset="1" stopColor="#e7b098"/></linearGradient></defs><rect width="520" height="470" fill="url(#blueprint-grid)"/><g className="sketch-figure"><path d={shape} fill="#84b9c110" stroke="url(#wire-light)" strokeWidth="1.5"/><ellipse cx="357" cy="107" rx="29" ry="34" transform="rotate(20 357 107)" fill="#84b9c110" stroke="#a4c5c8" strokeWidth="1.5"/><g clipPath="url(#runner-shape)" fill="none" stroke="#8dbac5" strokeOpacity=".55" strokeWidth=".8">{Array.from({length:38},(_,i)=><path key={`h${i}`} d={`M90 ${55+i*11} Q270 ${i*11+10} 470 ${65+i*11}`}/>)}{Array.from({length:30},(_,i)=><path key={`v${i}`} d={`M${105+i*13} 45 Q${65+i*17} 255 ${140+i*11} 452`}/>)}</g><g className="sketch-scan" clipPath="url(#runner-shape)"><rect x="90" y="50" width="390" height="18" fill="#eeb99c" fillOpacity=".13"/></g></g><g fill="none" stroke="#bda792" strokeWidth=".8" opacity=".65"><circle cx="322" cy="221" r="7"/><path d="M322 198 V244 M299 221 H345 M90 432 H430 M90 427 V437 M430 427 V437"/><path strokeDasharray="4 6" d="M375 102 H469 V379"/></g></svg><figcaption>Условная иллюстрация · не ваши данные и не образец техники</figcaption></figure>;
}
function ReviewCard({ card, person }) {
  const visible = person === 'all' ? Object.keys(card.people) : [person].filter(id => card.people[id]);
  return <article id={card.id} className="review-card" data-card={card.id}>
    <div className="card-title-row"><span className="exercise-tag">{categories.find(([id]) => id === card.category)?.[1]}</span><a className="permalink" href={appHref('starts',person,card.id)} aria-label={`Ссылка на ${card.title}`}>↗</a></div><h2>{card.title}</h2>
    {visible.map(id => { const review = card.people[id]; const athlete = people[id]; return <section className={`person-review ${id}`} key={id} data-review-person={id} aria-label={`${athlete.name}: ${card.title}`}>
      <h3><span className={`person-dot ${id}`} />{athlete.name}<small>{athlete.identification}</small></h3>
      <div className="assessment"><div><span className="assessment-label">Что оставить</span><p>{athlete.name}, {review.good.charAt(0).toLowerCase() + review.good.slice(1)}</p></div><div><span className="assessment-label change">Что поправить или проверить</span><p>{review.change}</p></div></div>
      <div className="evidence"><span className="eyebrow">Как сейчас · свои кадры</span>{review.photos.length ? review.photos.map(photo => <Photo key={photo.file} photo={photo}/>) : <p className="missing-frame">Пригодного личного кадра для этой оценки пока нет. Схема ниже его не заменяет.</p>}</div>
      {review.angles.length > 0 && <dl className="angles">{review.angles.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <div className="cue"><span>Одна команда на повтор</span><strong>{card.cue || athlete.cue}</strong></div>
      <details className="explanation"><summary>Почему, как почувствовать и как проверить</summary><div className="detail-content"><h4>Почему это связано с задачей</h4><p>{review.why}</p><h4>Как попробовать</h4><p>{review.how}</p><h4>Как проверить</h4><p>{review.check}</p>{review.limits && <div className="limit"><b>Граница вывода</b><p>{review.limits}</p></div>}</div></details>
    </section>; })}
    <details className="target"><summary>Какое действие пробуем получить · схема</summary><figure><img loading="lazy" width={data.dimensions[card.target]?.[0]} height={data.dimensions[card.target]?.[1]} src={ASSETS + card.target} alt={card.targetCaption}/><figcaption>{card.targetCaption}</figcaption></figure></details>
    <Sources sources={card.sources}/>
  </article>;
}
function Home({ person }) {
  const visible = person === 'all' ? Object.keys(people) : [person];
  return <><div className="home-hero"><div><PageTitle eyebrow="Тренировочная база · 5 октября 2026" title="Старт и первые 30 метров">Учимся стартовать и разгоняться без колодок. Здесь можно увидеть своё движение, понять следующую пробу и проверить, помогает ли она ускорению.</PageTitle><a className="primary-button" href={appHref('starts',person)}>Открыть разбор с кадрами →</a><div className="hero-process"><span>01 / Увидеть</span><span>02 / Попробовать</span><span>03 / Проверить</span></div></div><MotionSketch/></div>
    <div className="athlete-overviews">{visible.map(id => <article className={`athlete-overview ${id}`} key={id}><div className="athlete-heading"><span className={`person-dot ${id}`} /><h2>{people[id].name}</h2><span>{people[id].identification}</span></div><p>{people[id].priority}</p><blockquote>{people[id].cue}</blockquote><a className="primary-button" href={appHref('starts',id,id === 'ramir' ? 'red-start' : 'white-start')}>Открыть мой разбор →</a></article>)}</div>
    <div className="section-heading"><h2>База, к которой возвращаемся</h2><span>Исходный запрос сохранён</span></div><div className="quick-grid">{[['plan','Следующая тренировка','Пять упражнений, повторы, отдых и одна команда.'],['skills','Все восемь навыков','Готовые и местные инструкции, поиск кандидатов и исходные файлы.'],['map','Карта освоения','Что объяснено, что пробуем, где ещё нет проверки.'],['tasks','Что ещё не завершено','Все части большого запроса и границы текущего результата.']].map(([route,title,description]) => <a className="quick-card" href={appHref(route,person)} key={route}><h3>{title} <span>↗</span></h3><p>{description}</p></a>)}</div>
    <aside className="context-note"><b>Цель — результат на 5, 10, 20 и 30 м.</b><p>Красивый кадр и улучшение времени — разные проверки. Дата занятия и замедление пока неизвестны; выигрыш в скорости не измерен.</p></aside></>;
}
function Starts({ person, change }) {
  const [category,setCategory] = useState(currentCategory);
  const [search,setSearch] = useState('');
  const listRef = useRef(null);
  useEffect(() => { const update = () => setCategory(currentCategory()); window.addEventListener('popstate',update); return () => window.removeEventListener('popstate',update); },[]);
  function chooseCategory(id) { setCategory(id); const url = new URL(location.href); id === 'all' ? url.searchParams.delete('exercise') : url.searchParams.set('exercise',id); url.hash=''; history.pushState({},'',url); }
  const cards = data.cards.filter(card => {
    const searchable = person === 'all' ? card : { title:card.title, cue:card.cue, review:card.people[person] };
    return (person === 'all' || card.people[person]) && (category === 'all' || card.category === category) && JSON.stringify(searchable).toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'));
  });
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({block:'start'}));
  },[category,person]);
  return <><PageTitle eyebrow="Разбор старта · реальные кадры" title={person === 'all' ? 'Рамир и Миша: что менять сейчас' : `${people[person].name}: мои кадры и советы`}>Выберите спортсмена и упражнение. Внутри каждой карточки — оценка, кадр, команда и подробное объяснение.</PageTitle>
    <div className="review-toolbar"><AthletePicker person={person} change={change}/><span className="selection-note" role="status">{person === 'all' ? 'Показаны оба спортсмена' : `Показаны только кадры и советы: ${people[person].name}`}</span></div>
    <div className="exercise-filters" role="group" aria-label="Выбрать упражнение">{categories.map(([id,label]) => <button key={id} aria-pressed={category === id} onClick={() => chooseCategory(id)}>{label}</button>)}</div>
    <label className="search-field"><span>Найти совет</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Например: спина, колено, стопа"/></label>
    <div className="review-meta"><span>{cards.length} карточек</span><a href={docHref('reviews/2026-10-04-starts.md')}>Полный отчёт по 14 пунктам ↗</a></div>
    <div ref={listRef} className="review-list">{cards.map(card => <ReviewCard key={card.id} card={card} person={person}/>)}{!cards.length && <div className="empty-state"><h2>Такого совета пока нет</h2><p>Попробуйте другое слово или верните все упражнения.</p><button onClick={() => {setSearch('');chooseCategory('all');}}>Сбросить поиск</button></div>}</div>
    <a className="primary-button" href={appHref('plan',person)}>Открыть объём следующей тренировки →</a></>;
}
function Skills() {
  const [kind,setKind] = useState('all'); const [search,setSearch] = useState('');
  const skills = data.skills.filter(skill => (kind === 'all' || kind === skill.kind) && `${skill.title} ${skill.id} ${skill.candidates}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageTitle eyebrow="Навыки ассистента · полный каталог" title="Готовые навыки проверены. Файлы здесь.">Восемь инструкций для работы с проектом: два готовых научных модуля и шесть местных, включая координатор. Для каждого направления искали публичные варианты.</PageTitle>
    <div className="resource-links"><a href={`${GITHUB}/tree/main/.agents/skills`}>Открыть .agents/skills в корне GitHub ↗</a><a href={docHref('docs/skill-audit.md')}>Полный аудит десяти репозиториев ↗</a></div>
    <div className="exercise-filters" role="group" aria-label="Происхождение навыка">{[['all','Все 8'],['imported','Готовые 2'],['local','Местные 6']].map(([id,label]) => <button key={id} aria-pressed={kind===id} onClick={() => setKind(id)}>{label}</button>)}</div>
    <label className="search-field"><span>Найти навык</span><input type="search" placeholder="Видео, наука, нагрузка…" value={search} onChange={e => setSearch(e.target.value)}/></label>
    <div className="skill-list">{skills.map(skill => <article className="skill-card" id={skill.id} key={skill.id} data-skill={skill.id}><div className="card-title-row"><span className={`origin-tag ${skill.kind}`}>{skill.kind==='imported' ? 'Готовый · импортирован' : 'Местный · для этого проекта'}</span><span className="file-count">{skill.files.length} файлов</span></div><h2>{skill.title}</h2><p className="skill-id">{skill.id}</p><h3>Какие готовые варианты искали</h3><p>{skill.candidates}</p><h3>Почему выбрали этот вариант</h3><p>{skill.decision}</p><div className="resource-links"><a href={`${GITHUB}/blob/main/.agents/skills/${skill.id}/SKILL.md`}>Файл SKILL.md ↗</a>{skill.upstream && <a href={skill.upstream}>Исходный репозиторий ↗</a>}{skill.licenseFile && <a href={`${GITHUB}/blob/main/${skill.licenseFile}`}>Лицензия MIT ↗</a>}</div><details className="explanation"><summary>Прочитать инструкцию здесь</summary><Markdown origin={`.agents/skills/${skill.id}/SKILL.md`}>{skill.instructions.replace(/^---\n[\s\S]*?\n---\n/,'')}</Markdown></details>{skill.provenance && <details className="explanation"><summary>Происхождение и изменения</summary><Markdown>{skill.provenance}</Markdown></details>}</article>)}</div>
    <aside className="context-note"><b>Навык — это порядок работы ассистента.</b><p>Наличие файла не доказывает точность распознавания или пользу упражнения. Прямые проверки по видео и переноса в разгон остаются обязательными. Готовый навык именно Альберта Сафина в проведённом поиске не найден; предположения разбираем своим прозрачным модулем.</p></aside></>;
}
function MapPage({ person, change }) {
  const visible = person === 'all' ? Object.keys(people) : [person];
  return <><PageTitle eyebrow="Карта освоения · 60 и 100 м" title="Где уже есть наблюдения, а где ещё темно">Объяснили, попробовали и устойчиво перенесли в скорость — разные состояния. Процент всей лёгкой атлетики не вычисляем.</PageTitle><AthletePicker person={person} change={change}/><div className="map-legend"><span>Не исследовано</span><span>Объяснено</span><span className="active">Пробуется</span><span>Повторяется и переносится</span></div><p className="context-note compact">Устойчивый перенос в результат пока не подтверждён ни для одного стартового упражнения.</p><div className="map-grid">{data.map.map(row => <article className="map-card" key={row.area}><h2>{row.area}</h2>{visible.map(id => <div key={id} data-map-person={id}><h3><span className={`person-dot ${id}`}/>{people[id].name}</h3><p>{row[id]}</p></div>)}<div className="next-check"><b>Следующая проверка</b><p>{row.next}</p></div></article>)}</div></>;
}
function Learning() { return <><PageTitle eyebrow="Обучение · ваши исходные гипотезы" title="Где замедляться, а где нужна скорость">Не требуем идеального кадра до начала бега. Но повторение движения без выполнения задачи само по себе не обещает исправления.</PageTitle><div className="learning-rules"><article><h2>Положение</h2><p>Hold и March можно замедлить: собрать позу и почувствовать движение ноги.</p></article><article><h2>Быстрая смена</h2><p>Single Switch — одна быстрая смена с устойчивым окончанием. Медленный марш лишь подготовка.</p></article><article><h2>Ускорение</h2><p>Быстрое движение — часть задачи. Упростить старт, сократить отрезок, дать полный отдых.</p></article></div><div className="skill-list">{data.assumptions.map(row => <article className="skill-card" key={row.idea}><p className="eyebrow">Предположение из запроса</p><h2>{row.idea}</h2><p>{row.finding}</p><div className="next-check"><b>Как проверить</b><p>{row.check}</p></div></article>)}</div><Sources sources={[["Сложность задачи и обучение","https://doi.org/10.3200/jmbr.36.2.212-224"],["Сила и спринтерский результат","https://doi.org/10.1007/s40279-014-0227-1"]]}/><a className="text-link" href={docHref('docs/assumptions.md')}>Предпосылки и ограничения полностью ↗</a></>; }
function Research() {
  const [tab,setTab] = useState('sources');
  const tabs=[['sources','Реестр источников'],['research','Что следует из данных'],['pipeline','Порядок разбора'],['audit','Поиск готовых навыков']];
  return <><PageTitle eyebrow="Исследования · проверяемые основания" title="Что прочитано и что действительно посмотрели">Отдельно указываем полный текст, аннотацию, просмотренные кадры и непрочитанный материал.</PageTitle><div className="research-stats"><div><strong>23</strong><span>научные работы: исходные 21 + две о спине</span></div><div><strong>15</strong><span>видеовыборок, не полные просмотры</span></div><div><strong>1</strong><span>советский фильм визуально проверен</span></div></div><aside className="context-note"><b>10–20 советских фильмов пока не просмотрены.</b><p>Есть фильм о Борзове, выбранные страницы книги и диафильм Рохлина. Каталог архива не считается просмотром фильма. Точный норматив Wall-углов и превосходство Push-Up для ваших ошибок не установлены.</p></aside><div className="exercise-filters" role="group" aria-label="Исследовательский документ">{tabs.map(([id,label]) => <button key={id} aria-pressed={tab===id} onClick={() => setTab(id)}>{label}</button>)}</div><article className="document"><Markdown origin={`docs/${{sources:'start-sources',research:'start-research',pipeline:'start-analysis-pipeline',audit:'skill-audit'}[tab]}.md`}>{data.documents[tab]}</Markdown></article></>;
}
function Tasks() { return <><PageTitle eyebrow="Исходный большой запрос · состояние задач" title="Система обучения, а не список случайных упражнений">Весь запрос разделён на результаты и проверки. Частично выполненную задачу не выдаём за завершённую.</PageTitle><aside className="context-note"><b>Остаётся работа</b><p>Советская видеовыборка; непросмотренные попытки длинных записей; скрытые контакты; реальные 5–30 м; перенос в колодки. Все прошлые чаты автоматически недоступны — используем этот разговор и записи проекта.</p></aside><div className="task-list">{data.tasks.map(row => <article className="task-card" key={row.request}><h2>{row.request}</h2><h3>Что уже есть</h3><Markdown origin="docs/start-task-status.md">{row.done}</Markdown><div className="next-check"><b>Граница и следующий результат</b><Markdown origin="docs/start-task-status.md">{row.next}</Markdown></div></article>)}</div><a href={docHref('docs/start-task-status.md')}>Полный журнал задач и уточнений ↗</a></>; }
function Plan({ person }) { return <><PageTitle eyebrow="Следующая тренировка · условный план" title="Одна задача: выход вперёд">Пять упражнений. Доза пробная, нагрузка не увеличена автоматически. План заменяет прежний стартовый блок.</PageTitle>{person !== 'all' && <div className={`cue ${person}`}><span>{people[person].name}: основная команда старта</span><strong>{people[person].cue}</strong></div>}<article className="document"><Markdown origin="plans/next-start-session.md">{data.documents.plan}</Markdown></article><a className="primary-button" href={appHref('starts',person)}>Вернуться к кадрам и командам →</a></>; }
function App() {
  const route=pageRoute(); const [person,setPerson]=useState(currentAthlete);
  useEffect(() => { const sync=()=>setPerson(currentAthlete()); window.addEventListener('popstate',sync); return ()=>window.removeEventListener('popstate',sync); },[]);
  function change(id) {
    setPerson(id); const url=new URL(location.href); id==='all' ? url.searchParams.delete('athlete') : url.searchParams.set('athlete',id);
    const card=data.cards.find(c => c.id === url.hash.slice(1));
    if (card && id!=='all' && !card.people[id])url.hash='';
    history.pushState({},'',url);
  }
  useEffect(() => { document.title=`${sections.find(([id])=>id===route)?.[1] || 'Разборы'} · Рамир и Миша`; },[route]);
  const content={starts:<Starts person={person} change={change}/>,skills:<Skills/>,map:<MapPage person={person} change={change}/>,learning:<Learning/>,research:<Research/>,tasks:<Tasks/>,plan:<Plan person={person}/>}[route] || <Home person={person}/>;
  return <><a className="skip-link" href="#main-content">К содержимому</a><Header route={route} person={person}/><main id="main-content" className="site-main">{content}</main><footer className="site-footer"><b>Рамир × Миша</b><p>Разбор обновлён 5 октября 2026. Дата съёмки и замедление неизвестны. Схемы — объяснение действия, не доказанный эталон.</p><div className="resource-links"><a href={GITHUB}>GitHub ↗</a><a href={docHref('reviews/2026-10-04-starts-phone.md')}>Обычная версия без React</a><a href={`${BASE}red/`}>Прежние СБУ Рамира</a><a href={`${BASE}white/`}>Прежние СБУ Миши</a></div></footer></>;
}
createRoot(document.getElementById('root')).render(<App/>);
