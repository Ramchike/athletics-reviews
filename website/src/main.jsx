import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import data from './project-data.json';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const REPO = 'https://github.com/Ramchike/athletics-reviews/blob/main/';
const { review, program, docs } = data;
const PEOPLE = ['ramir', 'misha'];
const VERDICT = {
  ok: { icon: '🟢', label: 'Норм' },
  fix: { icon: '🔴', label: 'Исправить' },
  unknown: { icon: '⚪', label: 'Не видно' },
};
const PAGES = [
  ['path', 'Путь'],
  ['review', 'Разбор'],
  ['technique', 'Техника'],
  ['plan', 'Тренировка'],
  ['about', 'Как работаем'],
];

// Hash routing keeps GitHub Pages free of 404s: #/review/ramir, #/technique/<anchor>.
function parseHash() {
  const [page = 'path', arg = ''] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  return { page: PAGES.some(([id]) => id === page) ? page : 'path', arg };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const update = () => setRoute(parseHash());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const target = route.arg && document.getElementById(route.arg);
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }, [route.page, route.arg]);
  return route;
}

const slug = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const textOf = children => React.Children.toArray(children).map(child => typeof child === 'string' ? child : textOf(child.props?.children)).join('');

function docLink(href) {
  const [file, anchor = ''] = href.split('#');
  const name = file.split('/').pop();
  const pages = { 'technique.md': 'technique', 'roadmap.md': 'path', 'feedback.md': 'about' };
  if (!file) return `#/${parseHash().page}/${anchor}`;
  if (pages[name]) return `#/${pages[name]}/${anchor}`;
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

function Header({ page }) {
  return (
    <header className="site-header">
      <div className="brand-row">
        <a className="brand" href="#/path"><span className="brand-mark">↗</span>Рамир <b>×</b> Миша</a>
        <span className="brand-note">60 / 100 м</span>
      </div>
      <nav className="main-nav">
        {PAGES.map(([id, title]) => (
          <a key={id} href={`#/${id}`} aria-current={page === id ? 'page' : undefined}>{title}</a>
        ))}
      </nav>
    </header>
  );
}

function PersonSwitch({ who, page }) {
  const options = [['all', 'Оба'], ['ramir', 'Рамир'], ['misha', 'Миша']];
  return (
    <div className="switch" role="tablist" aria-label="Спортсмен">
      {options.map(([id, title]) => (
        <a key={id} role="tab" href={`#/${page}/${id}`} aria-selected={who === id} className={`switch-option ${id}`}>
          {id !== 'all' && <i className={`dot ${id}`} />}{title}
        </a>
      ))}
    </div>
  );
}

const selected = who => (PEOPLE.includes(who) ? [who] : PEOPLE);

function PathPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Маршрут</span>
        <h1>Как бежать быстрее</h1>
        <div className="stats">
          <div className="stat"><small>60 м сейчас</small><b>8,3–8,4</b><small>цель II разряд — 7,4</small></div>
          <div className="stat"><small>100 м сейчас</small><b>14–14,5</b><small>цель II разряд — 11,8</small></div>
        </div>
      </section>
      <section className="focus-grid">
        {PEOPLE.map(id => {
          const person = review.people[id];
          return (
            <a key={id} className={`focus ${id}`} href={`#/review/${id}`}>
              <span className="eyebrow"><i className={`dot ${id}`} />{person.name} · главное сейчас</span>
              <p className="focus-text">{person.focus}</p>
              <p className="cue">«{person.cue}»</p>
              <span className="more">Разбор с кадрами →</span>
            </a>
          );
        })}
      </section>
      <Markdown source={docs.roadmap} page="path" />
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
  const rows = [['Что хорошо', person.good], ['Почему важно', person.why], ['Ощущение', person.feel], ['Как проверить', person.check]];
  return (
    <article className={`verdict ${person.verdict} ${id}`}>
      <header>
        <span className="who"><i className={`dot ${id}`} />{review.people[id].name}</span>
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
        <p className="lead">🟢 норм — оставить · 🔴 исправить — мешает времени · ⚪ не видно — переснять. На тренировку каждому одна главная подсказка.</p>
      </section>
      <PersonSwitch who={who} page="review" />
      <div className="cues">
        {selected(who).map(id => (
          <p key={id} className={`cue-line ${id}`}><i className={`dot ${id}`} /><b>{review.people[id].name}:</b> «{review.people[id].cue}»</p>
        ))}
      </div>
      {review.cards.map(card => (
        <section key={card.id} id={card.id} className="card">
          <span className="eyebrow">{card.phase}</span>
          <h2>{card.title}</h2>
          {selected(who).map(id => <Verdict key={id} id={id} card={card} />)}
          <details className="target">
            <summary>Как должно быть</summary>
            <img src={`${BASE}${review.assets}${card.target}`} alt={card.targetCaption} loading="lazy" />
            <p className="muted">{card.targetCaption}</p>
            <p>
              {card.references.map(([title, url]) => <a key={url} href={url} target="_blank" rel="noreferrer">{title} ↗</a>)}
              <a href={`#/technique/${card.technique}`}>Критерии в учебнике →</a>
            </p>
          </details>
        </section>
      ))}
      <section className="card">
        <h2>Как снимать в следующий раз</h2>
        <ul>{review.reshoot.map(line => <li key={line}>{line}</li>)}</ul>
      </section>
    </>
  );
}

function TechniquePage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Учебник</span>
        <h1>Техника спринта</h1>
        <p className="lead">По фазам: как правильно, самые дорогие ошибки, как увидеть на видео, подсказка, упражнение.</p>
      </section>
      <Markdown source={docs.technique} page="technique" />
    </>
  );
}

function OwnClip({ id, own }) {
  if (!own?.video) return null;
  return (
    <figure className="clip">
      <video src={`${BASE}reviews/assets/program-2026-10-05/${own.video}`} poster={`${BASE}reviews/assets/program-2026-10-05/${own.poster}`} controls muted playsInline preload="none" />
      <figcaption><i className={`dot ${id}`} />{review.people[id].name}{own.phase ? ` · ${own.phase}` : ''}</figcaption>
    </figure>
  );
}

function Exercise({ exercise, who }) {
  const dose = typeof exercise.dose === 'string'
    ? exercise.dose
    : selected(who).map(id => `${review.people[id].name}: ${exercise.dose[id]}`).join(' · ');
  return (
    <details className="exercise" id={exercise.id}>
      <summary>
        <b>{exercise.title}</b>
        <span>{exercise.role}</span>
      </summary>
      <dl>
        <div className="row"><dt>Сколько</dt><dd>{dose}</dd></div>
        {exercise.rest && <div className="row"><dt>Отдых</dt><dd>{exercise.rest}</dd></div>}
      </dl>
      {exercise.how && <ol>{exercise.how.map(step => <li key={step}>{step}</li>)}</ol>}
      <dl>
        {[['Зачем', exercise.why], ['Ощущение', exercise.feel], ['Как проверить', exercise.check], ['Когда остановиться', exercise.stop]]
          .filter(([, text]) => text)
          .map(([title, text]) => <div key={title} className="row"><dt>{title}</dt><dd>{text}</dd></div>)}
      </dl>
      <div className="clips">{selected(who).map(id => <OwnClip key={id} id={id} own={exercise.own?.[id]} />)}</div>
      {exercise.reference && (
        <p><a href={exercise.reference.url} target="_blank" rel="noreferrer">Как надо: {exercise.reference.title} ↗</a></p>
      )}
    </details>
  );
}

function PlanPage({ who }) {
  const byId = Object.fromEntries(program.exercises.map(exercise => [exercise.id, exercise]));
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Воскресенье · {program.totalMinutes} минут</span>
        <h1>Тренировка</h1>
        <p className="lead">{program.goal}</p>
      </section>
      <PersonSwitch who={who} page="plan" />
      {selected(who).map(id => (
        <aside key={id} className={`readiness ${id}`}><b>{review.people[id].name}: {program.readiness[id].status}</b><p>{program.readiness[id].note}</p></aside>
      ))}
      <ol className="timeline">
        {program.segments.map(segment => (
          <li key={segment.id} style={{ '--size': segment.end - segment.start }}>
            <span className="time">{segment.start}–{segment.end} мин</span>
            <b>{segment.title}</b>
            {segment.exercises.map(id => byId[id] && <Exercise key={id} exercise={byId[id]} who={who} />)}
          </li>
        ))}
      </ol>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Как работаем</span>
        <h1>Что исправили в разборах</h1>
        <p className="lead">
          Видео лежат на Google Drive. Агент читает нужные кадры без скачивания целого файла, сам ставит точки и даёт вердикт.
          Инструкции агента — <a href={`${REPO}.agents/skills/sprint-video-review/SKILL.md`}>скиллы в репозитории</a>.
        </p>
      </section>
      <Markdown source={docs.feedback} page="about" />
    </>
  );
}

function App() {
  const { page, arg } = useRoute();
  const who = PEOPLE.includes(arg) ? arg : 'all';
  const pages = {
    path: <PathPage />,
    review: <ReviewPage who={who} />,
    technique: <TechniquePage />,
    plan: <PlanPage who={who} />,
    about: <AboutPage />,
  };
  return (
    <>
      <Header page={page} />
      <main className="site-main">{pages[page]}</main>
      <footer className="site-footer"><a href="https://github.com/Ramchike/athletics-reviews">Исходники на GitHub</a></footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
