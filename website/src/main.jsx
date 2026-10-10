import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import data from './project-data.json';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const REPO = 'https://github.com/Ramchike/athletics-reviews/blob/main/';
const { review, programme, clips, docs } = data;
const PEOPLE = ['ramir', 'misha'];
const NAME = { ramir: 'Рамир', misha: 'Миша' };
const EXERCISE = Object.fromEntries(programme.exercises.map(exercise => [exercise.id, exercise]));
const VERDICT = {
  ok: { icon: '🟢', label: 'Норм' },
  fix: { icon: '🔴', label: 'Исправить' },
  unknown: { icon: '⚪', label: 'Не видно' },
};
const STATUS = { done: 'освоено', now: 'сейчас', next: 'следующий', parallel: 'параллельно', later: 'потом' };
const PAGES = [
  ['train', 'Тренировка'],
  ['path', 'Путь'],
  ['drills', 'Упражнения'],
  ['technique', 'Техника'],
  ['review', 'Разборы'],
];

// Hash routing keeps GitHub Pages free of 404s: #/path, #/technique/<anchor>.
function parseHash() {
  const [page = 'train', arg = ''] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  return { page: PAGES.some(([id]) => id === page) ? page : 'train', arg };
}

// Scroll only when the page or anchor changes; filters and opened cards keep the position.
function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const update = () => setRoute(parseHash());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useLayoutEffect(() => {
    const target = route.arg && document.getElementById(route.arg);
    if (target?.tagName === 'DETAILS') target.open = true;
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }, [route.page, route.arg]);
  return route;
}

function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
}

const selected = who => (PEOPLE.includes(who) ? [who] : PEOPLE);
const slug = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const textOf = children => React.Children.toArray(children).map(child => typeof child === 'string' ? child : textOf(child.props?.children)).join('');
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function docLink(href) {
  const [file, anchor = ''] = href.split('#');
  const name = file.split('/').pop();
  if (!file) return `#/${parseHash().page}/${anchor}`;
  if (name === 'technique.md') return `#/technique/${anchor}`;
  if (name === 'roadmap.md') return '#/path';
  return new URL(href, REPO + 'docs/').href;
}

function Markdown({ source, page }) {
  const heading = Tag => ({ children }) => {
    const id = slug(textOf(children));
    return <Tag id={id}><a className="anchor" href={`#/${page}/${id}`}>{children}</a></Tag>;
  };
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: () => null,
          h2: heading('h2'),
          h3: heading('h3'),
          a: ({ href = '', children }) => {
            const target = docLink(href);
            const external = /^https?:/.test(target);
            return <a href={target} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a>;
          },
          table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function Header({ page, who, setWho }) {
  return (
    <header className="site-header">
      <div className="brand-row">
        <a className="brand" href="#/train"><span className="brand-mark">↗</span>Рамир <b>×</b> Миша</a>
        <div className="switch" role="group" aria-label="Спортсмен">
          {[['all', 'Оба'], ...PEOPLE.map(id => [id, NAME[id]])].map(([id, title]) => (
            <button key={id} type="button" aria-pressed={who === id} onClick={() => setWho(id)}>
              {id !== 'all' && <i className={`dot ${id}`} />}{title}
            </button>
          ))}
        </div>
      </div>
      <nav className="main-nav">
        {PAGES.map(([id, title]) => (
          <a key={id} href={`#/${id}`} aria-current={page === id ? 'page' : undefined}>{title}</a>
        ))}
      </nav>
    </header>
  );
}

function YouTube({ video }) {
  const start = video.start ?? 0;
  return (
    <a className="yt" href={`https://www.youtube.com/watch?v=${video.id}&t=${start}s`} target="_blank" rel="noreferrer">
      <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" loading="lazy" />
      <span>▶ {video.title}{start ? ` · с ${clock(start)}` : ''}</span>
    </a>
  );
}

function OwnClip({ id, clip }) {
  return (
    <figure className="clip">
      <video src={`${BASE}${clips}${clip}.mp4`} poster={`${BASE}${clips}${clip}.jpg`} controls muted playsInline preload="none" />
      <figcaption><i className={`dot ${id}`} />{NAME[id]} — как сейчас</figcaption>
    </figure>
  );
}

function Exercise({ id, who }) {
  const exercise = EXERCISE[id];
  const own = selected(who).filter(person => exercise.own?.[person]);
  return (
    <details className="exercise">
      <summary>
        <b>{exercise.en}</b>
        <span>{exercise.ru}</span>
      </summary>
      <dl>
        <div className="row"><dt>Сколько</dt><dd>{exercise.dose}</dd></div>
        <div className="row"><dt>Главное</dt><dd>{exercise.key}</dd></div>
        {exercise.angle && <div className="row"><dt>Углы</dt><dd>{exercise.angle}</dd></div>}
      </dl>
      {exercise.how && <ol>{exercise.how.map(step => <li key={step}>{step}</li>)}</ol>}
      {(exercise.video || own.length > 0) && (
        <div className="media">
          {exercise.video && <YouTube video={exercise.video} />}
          {own.map(person => <OwnClip key={person} id={person} clip={exercise.own[person]} />)}
        </div>
      )}
    </details>
  );
}

function currentStage(person) {
  const index = programme.stages.findIndex(stage => stage.status[person] === 'now');
  return { index, stage: programme.stages[index] };
}

function StageBanner({ who }) {
  return (
    <div className="banner">
      {selected(who).map(id => {
        const { index, stage } = currentStage(id);
        if (!stage) return null;
        return (
          <a key={id} className={`banner-row ${id}`} href={`#/path/${stage.id}`}>
            <span className="eyebrow"><i className={`dot ${id}`} />{NAME[id]} · этап {index + 1} из {programme.stages.length} · {stage.title}</span>
            <b>{stage.focus[id]}</b>
          </a>
        );
      })}
    </div>
  );
}

function TrainPage({ who }) {
  const [sessionId, setSessionId] = useStored('session', programme.sessions[0].id);
  const [done, setDone] = useStored('done', {});
  const session = programme.sessions.find(item => item.id === sessionId) ?? programme.sessions[0];
  const toggle = key => setDone(state => ({ ...state, [key]: !state[key] }));
  const count = session.blocks.filter((_, index) => done[`${session.id}:${index}`]).length;
  return (
    <>
      <StageBanner who={who} />
      {programme.sessions.length > 1 ? (
        <div className="tabs" role="group" aria-label="Тренировка">
          {programme.sessions.map(item => (
            <button key={item.id} type="button" aria-pressed={item.id === session.id} onClick={() => setSessionId(item.id)}>{item.title}</button>
          ))}
        </div>
      ) : <h2 className="session-title">{session.title}</h2>}
      <p className="muted">{session.note}</p>
      <div className="session-progress">
        <div className="meter"><i style={{ width: `${(count / session.blocks.length) * 100}%` }} /></div>
        <span>{count} / {session.blocks.length}</span>
        {count > 0 && (
          <button type="button" className="link" onClick={() => setDone(state => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith(`${session.id}:`))))}>Сбросить</button>
        )}
      </div>
      <ol className="blocks">
        {session.blocks.map((block, index) => {
          const key = `${session.id}:${index}`;
          return (
            <li key={key} className={`block ${done[key] ? 'done' : ''}`}>
              <label className="block-head">
                <input type="checkbox" checked={!!done[key]} onChange={() => toggle(key)} />
                <span className="time">{block.start}–{block.end}′</span>
                <b>{block.title}</b>
              </label>
              {block.note && <p className="muted">{block.note}</p>}
              {block.exercises.map(id => <Exercise key={id} id={id} who={who} />)}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function TimeBar() {
  const { scale: [slow, fast], now, marks, event } = programme.progress;
  const at = value => `${((slow - value) / (slow - fast)) * 100}%`;
  return (
    <section className="timebar">
      <span className="eyebrow">{event} · секунды</span>
      <div className="bar">
        <i className="fill" style={{ width: at(now.value) }} />
        {marks.map((mark, index) => (
          <span key={mark.value} className={`tick ${index % 2 ? 'low' : ''}`} style={{ left: at(mark.value) }}>{mark.label}</span>
        ))}
        <span className="now" style={{ left: at(now.value) }}>{now.label}</span>
      </div>
      <ul className="marks">
        <li><b>{now.label}</b> сейчас ({now.when})</li>
        {marks.map(mark => <li key={mark.value}><b>{mark.label}</b> {mark.note}</li>)}
      </ul>
    </section>
  );
}

function Steps({ who }) {
  return (
    <div className="steps">
      {selected(who).map(id => (
        <div key={id} className="steps-row">
          <span className="who"><i className={`dot ${id}`} />{NAME[id]}</span>
          <div className="steps-track">
            {programme.stages.map((stage, index) => (
              <a key={stage.id} href={`#/path/${stage.id}`} className={`step ${stage.status[id]}`} title={stage.title}>{index + 1}</a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stage({ stage, index, who }) {
  const statuses = [...new Set(selected(who).map(id => stage.status[id]))];
  return (
    <details className={`stage ${statuses.join(' ')}`} id={stage.id} open={statuses.includes('now')}>
      <summary>
        <span className="stage-n">{index + 1}</span>
        <span>
          <b>{stage.title}</b>
          <small>{stage.en} · {statuses.map(status => STATUS[status]).join(' / ')}</small>
        </span>
      </summary>
      <p className="goal">{stage.goal}</p>
      {selected(who).map(id => <p key={id} className={`cue-line ${id}`}><i className={`dot ${id}`} /><b>{NAME[id]}:</b> {stage.focus[id]}</p>)}
      {stage.angles.length > 0 && (
        <>
          <h3>Углы и позиции</h3>
          <ul>{stage.angles.map(line => <li key={line}>{line}</li>)}</ul>
        </>
      )}
      <h3>Что тренить</h3>
      {stage.train.map(id => <Exercise key={id} id={id} who={who} />)}
      <h3>Как проверить</h3>
      <p>{stage.check}</p>
      {stage.videos.length > 0 && (
        <>
          <h3>Посмотреть</h3>
          <div className="media">{stage.videos.map(video => <YouTube key={video.id} video={video} />)}</div>
        </>
      )}
    </details>
  );
}

function PathPage({ who }) {
  return (
    <>
      <section className="hero">
        <h1>Путь</h1>
        <TimeBar />
        <Steps who={who} />
      </section>
      {programme.stages.map((stage, index) => <Stage key={stage.id} stage={stage} index={index} who={who} />)}
      <p className="muted">Подробно, с историями тех, кто выбежал из 11: <a href={`${REPO}docs/roadmap.md`}>roadmap.md</a></p>
    </>
  );
}

function DrillsPage({ who }) {
  const [query, setQuery] = useState('');
  const match = id => `${EXERCISE[id].en} ${EXERCISE[id].ru}`.toLowerCase().includes(query.trim().toLowerCase());
  const seen = new Set();
  const groups = [
    ...programme.stages.map(stage => [stage.title, stage.train]),
    ['Разминка и СБУ', programme.exercises.map(exercise => exercise.id)],
  ].map(([title, ids]) => [title, ids.filter(id => !seen.has(id) && seen.add(id))]);
  return (
    <>
      <input className="search" type="search" placeholder="Найти: wall, скип, старт…" value={query} onChange={event => setQuery(event.target.value)} />
      {groups.map(([title, ids]) => {
        const shown = ids.filter(match);
        return shown.length > 0 && (
          <section key={title} className="group">
            <span className="eyebrow">{title}</span>
            {shown.map(id => <Exercise key={id} id={id} who={who} />)}
          </section>
        );
      })}
    </>
  );
}

function TechniquePage() {
  return (
    <>
      <section className="hero">
        <h1>Техника</h1>
        <p className="lead">По фазам: как правильно, самые дорогие ошибки, подсказка, упражнение.</p>
      </section>
      <Markdown source={docs.technique} page="technique" />
    </>
  );
}

function Photo({ file, caption }) {
  const src = `${BASE}${review.assets}${file}`;
  return (
    <figure className="photo">
      <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={caption} loading="lazy" /></a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Verdict({ id, card }) {
  const person = card.people[id];
  const verdict = VERDICT[person.verdict];
  const rows = [['Что хорошо', person.good], ['Ощущение', person.feel], ['Как проверить', person.check]];
  return (
    <article className={`verdict ${person.verdict} ${id}`}>
      <header>
        <span className="who"><i className={`dot ${id}`} />{NAME[id]}</span>
        <span className={`badge ${person.verdict}`}>{verdict.icon} {verdict.label}</span>
      </header>
      <h3>{person.headline}</h3>
      <p>{person.detail}</p>
      {person.photos.length > 0 && (
        <div className="photos">{person.photos.map(([file, caption]) => <Photo key={file} file={file} caption={caption} />)}</div>
      )}
      <dl>
        {rows.filter(([, text]) => text).map(([title, text]) => (
          <div key={title} className="row"><dt>{title}</dt><dd>{text}</dd></div>
        ))}
      </dl>
    </article>
  );
}

function ReviewPage({ who }) {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Разбор видео</span>
        <h1>{review.session}</h1>
        <p className="lead">🟢 норм · 🔴 исправить · ⚪ не видно</p>
      </section>
      {review.cards.map(card => (
        <details key={card.id} id={card.id} className="card">
          <summary>
            <b>{card.title}</b>
            <span className="badges">{selected(who).map(id => <span key={id}>{VERDICT[card.people[id].verdict].icon}</span>)}</span>
          </summary>
          {selected(who).map(id => <Verdict key={id} id={id} card={card} />)}
          <div className="target">
            <img src={`${BASE}${review.assets}${card.target}`} alt={card.targetCaption} loading="lazy" />
            <p className="muted">Как должно быть: {card.targetCaption}</p>
          </div>
        </details>
      ))}
    </>
  );
}

function App() {
  const { page } = useRoute();
  const [who, setWho] = useStored('who', 'all');
  const pages = {
    train: <TrainPage who={who} />,
    path: <PathPage who={who} />,
    drills: <DrillsPage who={who} />,
    technique: <TechniquePage />,
    review: <ReviewPage who={who} />,
  };
  return (
    <>
      <Header page={page} who={who} setWho={setWho} />
      <main className="site-main">{pages[page]}</main>
      <footer className="site-footer"><a href="https://github.com/Ramchike/athletics-reviews">Исходники на GitHub</a></footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
