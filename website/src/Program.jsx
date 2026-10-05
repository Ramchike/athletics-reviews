import React, { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL;
const CLIPS = `${BASE}reviews/assets/program-2026-10-05/`;
const names = { ramir:'Рамир', misha:'Миша' };
const selected = person => person === 'all' ? ['ramir','misha'] : [person];
const href = (route, person, exercise, hash='') => {
  const query = new URLSearchParams();
  if (person !== 'all') query.set('athlete',person);
  if (exercise) query.set('exercise',exercise);
  return `${BASE}${route}/${query.size ? '?' + query : ''}${hash ? '#' + hash : ''}`;
};
const clock = minutes => `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
const fileTime = seconds => `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
const dose = (exercise,person) => typeof exercise.dose === 'string' ? exercise.dose : person === 'all' ? Object.entries(exercise.dose).map(([id,value])=>`${names[id]}: ${value}`).join(' · ') : exercise.dose[person];

export function Readiness({ program, person }) {
  return <div className="readiness-list">{selected(person).map(id => <aside key={id} className={`readiness ${id}`} data-readiness={id}>
    <b>{names[id]}: {program.readiness[id].status}</b>
    <p>{program.readiness[id].note}</p>
    {program.readiness[id].source && <a href={program.readiness[id].source} target="_blank" rel="noreferrer">Памятка о боли в спине · NHS ↗</a>}
  </aside>)}</div>;
}
function SessionNav({person,exercise}) {
  return <nav className="session-nav" aria-label="Программа и упражнения">
    <a href={href('plan',person)}>Вся программа · 2 часа</a>
    <a href={href('exercises',person,exercise)}>Упражнения и видео</a>
    <a href={href('map',person)}>Что тренировать дальше</a>
  </nav>;
}
function ReferenceVideo({reference}) {
  const [opened,setOpened]=useState(false);
  if(!reference)return <p className="missing-frame">Для спокойной ходьбы и записи отдельная техническая видеодемонстрация не требуется.</p>;
  const params=new URLSearchParams({start:reference.start,rel:0,playsinline:1});
  if(reference.end)params.set('end',reference.end);
  return <div className="reference-video">
    {opened ? <div className="embed-surface"><iframe title={reference.title} src={`https://www.youtube-nocookie.com/embed/${reference.youtubeId}?${params}`} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div> : <button className="video-open" onClick={()=>setOpened(true)}><span aria-hidden="true">▶</span><b>Показать авторское видео</b><small>{reference.title} · с {fileTime(reference.start)}</small></button>}
    <p className="video-caption">{reference.note}</p>
    <a href={reference.url} target="_blank" rel="noreferrer">Открыть у автора ↗</a>
    {opened && <p className="video-caption">Если встроенный плеер недоступен, используйте ссылку выше.</p>}
  </div>;
}
export function VideoComparison({program,exercise,person}) {
  return <section className="video-comparison" data-video-comparison={exercise.id}>
    <h2>Как у нас → какое действие ищем</h2>
    {selected(person).map(id=>{
      const own=exercise.own[id];
      return <div className="comparison-grid" key={id} data-comparison-person={id}>
        <div className="comparison-panel own-panel"><p className="eyebrow">Наше движение · {names[id]}</p><h3>{own.status}</h3>
          {own.video ? <><video key={own.video} controls playsInline preload="none" poster={CLIPS+own.poster} aria-label={`${names[id]}: ${exercise.title}`}><source src={CLIPS+own.video} type="video/mp4"/>Ваш браузер не поддерживает видео. Откройте файл по ссылке ниже.</video><p className="video-caption">{own.phase}. Повтор выбранных кадров, темп условный; без исходного звука.</p><a href={CLIPS+own.video} target="_blank" rel="noreferrer">Открыть своё видео крупно ↗</a></> : <p className="missing-frame">Пригодная личная серия пока не подтверждена.</p>}
          <p>{own.note}</p>{own.source && <a href={own.source} target="_blank" rel="noreferrer">Исходная запись на Drive ↗</a>}
        </div>
        <div className="comparison-panel target-panel"><p className="eyebrow">Авторский пример · задача движения</p><ReferenceVideo key={exercise.id+id} reference={exercise.reference}/><div className="target-action"><b>Что сравнивать</b><p>{exercise.check}</p></div></div>
      </div>;
    })}
    <p className="comparison-limit">Сравниваем действие в сопоставимой фазе. Разные ракурсы, скорость и пропорции не позволяют требовать одинаковых углов. Существующая разметка не измеряет причину боли.</p>
  </section>;
}
export function Roadmap({program}) {
  return <section className="roadmap"><h2>Путь от этой тренировки к 60 и 100 м</h2><p>Переход определяется повторяемостью и восстановлением, а не номером недели. Остальные качества остаются отдельными задачами.</p>
    <ol className="roadmap-list">{program.roadmap.map((step,index)=><li key={step.title} data-roadmap-step><span className="roadmap-number">{index+1}</span><div><p className="eyebrow">{step.status}</p><h3>{step.title}</h3><p>{step.why}</p><div className="next-check"><b>Когда переходить / как проверить</b><p>{step.check}</p></div></div></li>)}</ol>
  </section>;
}
export function Programme({program,person,change,AthletePicker,PageTitle,Markdown}) {
  useEffect(()=>{if(location.hash)requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView());},[]);
  return <><PageTitle eyebrow="Воскресное занятие · пробный план" title="Полная программа на 2 часа">A → B → C → оба Fast Legs → Wall → настоящие ускорения. Отдых, объяснения и просмотр уже включены в эти два часа.</PageTitle>
    <AthletePicker person={person} change={change}/><SessionNav person={person}/><Readiness program={program} person={person}/>
    <div className="cue"><span>Главная задача занятия</span><strong>{program.goal}</strong></div>
    <p className="context-note compact">{program.trial} По сообщению беговое занятие раз в неделю по воскресеньям; зал считается отдельно.</p>
    <section className="session-commands"><h2>Три команды, одна во время повтора</h2>{selected(person).map(id=><div key={id}><h3>{names[id]}</h3><p>Первая — для старта; остальные для Wall. Применять в готовом, безболезненном варианте.</p><ol>{program.commands[id].map(command=><li key={command}>{command}</li>)}</ol></div>)}</section>
    <div className="timeline-list">{program.segments.map(segment=><section key={segment.id} id={`block-${segment.id}`} className="timeline-block" data-program-block>
      <div className="timeline-heading"><span>{clock(segment.start)}–{clock(segment.end)}</span><h2>{segment.title}</h2><small>{segment.end-segment.start} мин, включая паузы</small></div>
      {segment.exercises.map(id=>{const exercise=program.exercises.find(e=>e.id===id);return <article className="timeline-exercise" key={id} data-program-exercise={id}>
        <h3>{exercise.title}</h3><p className="programme-dose">{dose(exercise,person)}</p><p><b>Отдых:</b> {exercise.rest}</p><p><b>Зачем:</b> {exercise.role}. {exercise.why}</p>
        <a className="primary-button" href={href('exercises',person,id)}>Как делать и видео →</a>
      </article>;})}
    </section>)}</div>
    <section className="volume-summary"><h2>Метры считаем отдельно</h2><p>A/B/C и оба Fast Legs: <b>{program.totals.drillsMeters} м учебных проходов</b>. Подводящие ускорения: <b>{program.totals.preparationMeters} м</b>. Удержания и ходьба в эти метры не входят.</p>
      {selected(person).map(id=><div key={id} data-volume-person={id}><h3>{names[id]}</h3><p>Базовые основные ускорения: {program.totals[id].baseMain} м. Верхний вариант с разрешёнными удлинениями: {program.totals[id].upperMain} м; с подводящими {program.totals[id].upperTotal} м. В шиповках до {program.totals[id].upperSpikes} м при указанной обуви.</p></div>)}
      <p>Это пределы будущего варианта, не факт выполнения и не обязанность закончить всю таблицу.</p>
    </section>
    <aside className="context-note"><b>Push-Up не добавляем отдельной серией.</b><p>Если готовность позволяет сравнение, он заменяет один назначенный 3-point на 10 м.</p><a href={href('exercises',person,'push-up')}>Открыть сравнение Push-Up и 3-point →</a></aside>
    <Roadmap program={program}/>
    <details className="explanation"><summary>Полный документ: дозировка, обувь и ограничения</summary><Markdown origin="plans/next-start-session.md">{program.fullPlan}</Markdown></details>
  </>;
}
function currentExercise(program) {
  const id=new URLSearchParams(location.search).get('exercise');
  return program.exercises.some(e=>e.id===id)?id:'a-skip';
}
export function Exercises({program,person,change,AthletePicker,PageTitle}) {
  const [id,setId]=useState(()=>currentExercise(program));
  useEffect(()=>{const sync=()=>setId(currentExercise(program));window.addEventListener('popstate',sync);return ()=>window.removeEventListener('popstate',sync);},[program]);
  const exercise=program.exercises.find(e=>e.id===id);
  const index=program.exercises.indexOf(exercise);
  const segment=program.segments.find(s=>s.exercises.includes(id));
  function choose(next) {
    setId(next);const url=new URL(location.href);url.searchParams.set('exercise',next);url.hash='';history.pushState({},'',url);
    requestAnimationFrame(()=>document.querySelector('.exercise-title')?.scrollIntoView({block:'start'}));
  }
  return <><PageTitle eyebrow="Упражнения · цель, действие, видео" title="Одна карточка — одна понятная задача">Выбор спортсмена меняет личную запись и оценку. Демонстрация автора показывает действие; результат проверяем своим ускорением.</PageTitle>
    <div className="exercise-navigation"><AthletePicker person={person} change={change}/><label>Выбрать упражнение<select aria-label="Выбрать упражнение" value={id} onChange={e=>choose(e.target.value)}>{program.exercises.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label></div>
    <SessionNav person={person} exercise={id}/><Readiness program={program} person={person}/>
    <article className="exercise-detail" data-exercise-detail={id} key={id}>
      <p className="eyebrow">{segment ? `${clock(segment.start)}–${clock(segment.end)} в программе` : 'Только замена назначенного повтора'}</p><h2 className="exercise-title">{exercise.title}</h2><p className="lead">{exercise.role}</p>
      <dl className="exercise-dose"><div><dt>Объём</dt><dd>{dose(exercise,person)}</dd></div><div><dt>Отдых</dt><dd>{exercise.rest}</dd></div><div><dt>Обувь и усилие</dt><dd>{exercise.footwear}. {exercise.effort}</dd></div></dl>
      <section data-explanation="why"><h3>Зачем и что тренирует</h3><p>{exercise.why}</p></section>
      <section data-explanation="how"><h3>Как делать</h3><ol className="how-list">{exercise.how.map(step=><li key={step}>{step}</li>)}</ol></section>
      <div className="cue"><span>Ощущение / ориентир · одна задача на повтор</span><strong>{exercise.feel}</strong></div>
      <section data-explanation="check"><h3>Как понять, что получается</h3><p>{exercise.check}</p></section><section data-explanation="stop"><h3>Когда упростить или закончить</h3><p>{exercise.stop}</p></section>
      <VideoComparison program={program} exercise={exercise} person={person}/>
      {exercise.review && <a className="text-link" href={href('starts',person,null,exercise.id==='three-point'?(person==='misha'?'white-start':'red-start'):exercise.review)}>Открыть наши линии, углы и полный разбор ↗</a>}
      <div className="sources"><span>Основания и ограничения</span>{exercise.sources.map(([title,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{title} ↗</a>)}</div>
    </article>
    <nav className="exercise-paging" aria-label="Предыдущее и следующее упражнение"><button disabled={index===0} onClick={()=>choose(program.exercises[index-1].id)}>← Предыдущее</button><button disabled={index===program.exercises.length-1} onClick={()=>choose(program.exercises[index+1].id)}>Следующее →</button></nav>
    <a className="primary-button" href={href('plan',person,null,segment?'block-'+segment.id:'block-starts')}>К полной программе →</a>
  </>;
}
