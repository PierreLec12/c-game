import { useNavigate } from "react-router-dom";
import { cardById, MENTOR } from "@desk/content";
import { useGame } from "../store";
import { Diagram } from "../charts/Diagram";

export function CardModal() {
  const queue = useGame((g) => g.cardQueue);
  const state = useGame((g) => g.state);
  const dismiss = useGame((g) => g.dismissCard);
  const openCard = useGame((g) => g.openCard);
  const nav = useNavigate();
  const id = queue[0];
  if (!id || !state) return null;
  const card = cardById(id);
  if (!card) return null;
  const close = () => { openCard(card.id); dismiss(); };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="card-title">
      <div className="modal">
        <div className="muted small">{MENTOR.name} · concept card · level {card.level}</div>
        <h1 id="card-title">{card.title}</h1>
        <Diagram kind={card.diagram} />
        <div className="sentences">{card.sentences.map((s, i) => <p key={i}>{s}</p>)}</div>
        <div className="worked">{card.worked(state)}</div>
        <div className="flex">
          <button className="primary" onClick={close}>Got it</button>
          <button onClick={() => { close(); nav(`/${card.showMe.screen}#${card.showMe.target}`); }}>Show me: {card.showMe.label}</button>
        </div>
      </div>
    </div>
  );
}
