/**
 * NÍVEIS DE FERIMENTO e DESCANSO (Livro de Regras do Ligéia).
 *
 * Quando um ataque leva os PV a 0, o dano EXCEDENTE define o nível de
 * ferimento. Os PV passam a ficar NEGATIVOS e o excedente é o módulo desse
 * valor — a -7 o personagem morre automaticamente.
 *
 *   PV  0        → Ferimentos Leves      (excedente 0)
 *   PV -1 a -2   → Ferimentos Moderados
 *   PV -3 a -4   → Ferimentos Graves     (Vigor Normal por turno)
 *   PV -5 a -6   → À Beira da Morte      (Vigor Difícil por turno)
 *   PV -7        → Morto
 *
 * Vale igualmente para personagens e NPCs.
 */
import { rollLigeia, postRollToChat, resolveAttr } from "./dice.mjs";
import { updateActorAsGM, canAffectActor } from "./gm-proxy.mjs";

/** PV em que o personagem morre automaticamente. */
export const DEATH_HP = -7;

/**
 * Faixas de ferimento, da mais leve para a mais grave. `hp` é o PV em que a
 * faixa COMEÇA (o valor menos severo dela) — usado ao reduzir o nível por
 * cuidados médicos ou cura mágica.
 */
export const WOUND_LEVELS = {
  leve: {
    key: "leve",
    label: "Ferimentos Leves",
    hp: 0,
    min: 0,
    max: 0,
    // Descanso: recupera PV normalmente e volta à consciência.
    restHp: "normal",
    wakesOnRest: true,
    turnRoll: null,
    desc: "Sem dano excedente. Recupera PV normalmente com um descanso e volta à consciência.",
  },
  moderado: {
    key: "moderado",
    label: "Ferimentos Moderados",
    hp: -1,
    min: -2,
    max: -1,
    // Descanso: recupera exatamente 1 PV e volta à consciência.
    restHp: 1,
    wakesOnRest: true,
    turnRoll: null,
    desc: "1 a 2 de dano excedente. Recupera 1 PV com um descanso e volta à consciência.",
  },
  grave: {
    key: "grave",
    label: "Ferimentos Graves",
    hp: -3,
    min: -4,
    max: -3,
    // Não recupera PV com descanso nem com cuidados médicos.
    restHp: 0,
    wakesOnRest: false,
    // Vigor (Normal) no começo de cada turno; falhou, vai à beira da morte.
    turnRoll: { difficulty: "normal", failTo: "beira" },
    // Cuidados médicos (Mente): 12+ → leve; 10+ → moderado.
    care: [
      { min: 12, to: "leve" },
      { min: 10, to: "moderado" },
    ],
    // Cura mágica: sobe para ferimentos leves, seja qual for o valor curado.
    magicTo: "leve",
    desc: "3 a 4 de dano excedente. Não recupera PV com descanso. Vigor (Normal) a cada turno ou piora.",
  },
  beira: {
    key: "beira",
    label: "À Beira da Morte",
    hp: -5,
    min: -6,
    max: -5,
    restHp: 0,
    wakesOnRest: false,
    // Vigor (Difícil) no começo de cada turno; falhou, morre.
    turnRoll: { difficulty: "dificil", failTo: "morto" },
    // Cuidados médicos (Mente): 12+ → moderado; 10+ → grave.
    care: [
      { min: 12, to: "moderado" },
      { min: 10, to: "grave" },
    ],
    magicTo: "moderado",
    desc: "5 a 6 de dano excedente. Não recupera PV com descanso. Vigor (Difícil) a cada turno ou morre.",
  },
  morto: {
    key: "morto",
    label: "Morto",
    hp: DEATH_HP,
    min: DEATH_HP,
    max: DEATH_HP,
    restHp: 0,
    wakesOnRest: false,
    turnRoll: null,
    desc: "7 de dano excedente. O personagem morreu.",
  },
};

/** CD das rolagens de Vigor por turno (ajustável em CONFIG.LIGEIA). */
export function woundDC(kind) {
  const table = CONFIG.LIGEIA?.difficulties || { normal: 8, dificil: 10 };
  return table[kind] ?? (kind === "dificil" ? 10 : 8);
}

/**
 * Nível de ferimento a partir do PV atual.
 * @param {number} hp
 * @returns {object|null} faixa de WOUND_LEVELS, ou null se estiver acima de 0
 *          (personagem saudável, sem nível de ferimento).
 */
export function woundLevelFor(hp) {
  const v = Math.floor(Number(hp) || 0);
  if (v > 0) return null;
  if (v <= DEATH_HP) return WOUND_LEVELS.morto;
  if (v <= -5) return WOUND_LEVELS.beira;
  if (v <= -3) return WOUND_LEVELS.grave;
  if (v <= -1) return WOUND_LEVELS.moderado;
  return WOUND_LEVELS.leve;
}

/** Nível de ferimento atual de um ator (null se estiver com PV > 0). */
export function woundOf(actor) {
  return woundLevelFor(actor?.system?.resources?.hp?.value ?? 0);
}

/** O ator está morto? */
export function isDead(actor) {
  return (actor?.system?.resources?.hp?.value ?? 0) <= DEATH_HP;
}

/**
 * Define o PV para o topo (valor menos severo) de uma faixa de ferimento.
 * Usado por cuidados médicos e cura mágica, que sobem o personagem de faixa
 * "independente de quantos pontos de vida ele recuperaria".
 * @returns {{from:string|null, to:string, hp:number}|null}
 */
export async function setWoundLevel(actor, key, { announce = true, reason = "" } = {}) {
  const level = WOUND_LEVELS[key];
  if (!canAffectActor(actor) || !level) return null;
  const fromLevel = woundOf(actor);
  await updateActorAsGM(actor, { "system.resources.hp.value": level.hp });
  if (announce) {
    const arrow = key === "morto" ? "☠" : "→";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong>: ${arrow} <span class="lig-wound lig-wound-${key}">${level.label}</span>${reason ? ` <span class="lig-cond-note">(${reason})</span>` : ""}</div>`,
    });
  }
  return { from: fromLevel?.key ?? null, to: key, hp: level.hp };
}

/**
 * ROLAGEM DE FERIMENTO no começo do turno.
 * Gravemente ferido → Vigor (Normal); falhou, vai à beira da morte.
 * À beira da morte → Vigor (Difícil); falhou, morre.
 */
export async function processWoundRollAtTurnStart(actor) {
  const level = woundOf(actor);
  if (!level?.turnRoll) return;
  const dc = woundDC(level.turnRoll.difficulty);
  const vigor = resolveAttr(actor, "vigor");
  const rm = actor.system?.rollMods || {};
  const result = await rollLigeia({
    attribute: vigor.value,
    improvement: vigor.dice + (vigor.rollDice || 0) + (rm.all?.dice || 0),
    bonus: (rm.all?.bonus || 0) + (vigor.rollBonus || 0),
    difficulty: dc,
  });
  const dcLabel = level.turnRoll.difficulty === "dificil" ? "Difícil" : "Normal";
  await postRollToChat({
    actor,
    label: `${level.label} — Vigor (${dcLabel}, CD ${dc})`,
    result,
    hidden: actor.system?.rollHidden ?? false,
  });
  if (result.outcome === "success") {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong> resiste e se mantém em <em>${level.label}</em>.</div>`,
    });
    return;
  }
  await setWoundLevel(actor, level.turnRoll.failTo, {
    reason: `falhou no Vigor (${dcLabel})`,
  });
}

/**
 * CUIDADOS MÉDICOS: rolagem de Mente que reduz o nível de ferimento.
 * Grave → 12+ leve, 10+ moderado. À beira da morte → 12+ moderado, 10+ grave.
 * @param {Actor} healer  quem cuida (rola Mente)
 * @param {Actor} patient  quem recebe (pode ser o mesmo)
 */
export async function performMedicalCare(healer, patient) {
  const level = woundOf(patient);
  if (!level?.care) {
    ui.notifications?.info(
      level?.key === "morto"
        ? `${patient.name} está morto — cuidados médicos não têm efeito.`
        : `${patient.name} não tem ferimentos que exijam cuidados médicos.`,
    );
    return null;
  }
  const mente = resolveAttr(healer, "mente");
  const rm = healer.system?.rollMods || {};
  const result = await rollLigeia({
    attribute: mente.value,
    improvement: mente.dice + (mente.rollDice || 0) + (rm.all?.dice || 0),
    bonus: (rm.all?.bonus || 0) + (mente.rollBonus || 0),
    difficulty: level.care[level.care.length - 1].min,
  });
  await postRollToChat({
    actor: healer,
    label: `Cuidados Médicos em ${patient.name} — Mente`,
    result,
    hidden: healer.system?.rollHidden ?? false,
  });
  const tier = level.care.find((c) => result.total >= c.min);
  if (!tier) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: patient }),
      content: `<div class="ligeia-roll-flavor">Os cuidados não foram suficientes — <strong>${patient.name}</strong> continua em <em>${level.label}</em>.</div>`,
    });
    return { improved: false, result: result.total };
  }
  await setWoundLevel(patient, tier.to, { reason: `cuidados médicos (${result.total})` });
  return { improved: true, to: tier.to, result: result.total };
}

/**
 * DESCANSO (8 horas).
 * Recupera PV igual ao Vigor, PM igual à Mente e TODOS os pontos heroicos.
 * Em local inapropriado, recupera apenas METADE de tudo.
 * Os níveis de ferimento limitam a recuperação de PV:
 *   leve → normal · moderado → 1 PV · grave/beira → nenhum PV.
 *
 * @param {Actor} actor
 * @param {{proper?: boolean}} opts  proper=false → local inapropriado
 * @returns {object} resumo do que foi recuperado
 */
export async function performRest(actor, { proper = true } = {}) {
  if (!actor?.isOwner) {
    ui.notifications?.warn("Sem permissão para alterar esta ficha.");
    return null;
  }
  const sys = actor.system || {};
  const hp = sys.resources?.hp || {};
  const mp = sys.resources?.mp || {};
  const ph = sys.resources?.heroic || {};
  const level = woundOf(actor);

  if (level?.key === "morto") {
    ui.notifications?.warn(`${actor.name} está morto e não pode descansar.`);
    return null;
  }

  const half = (n) => Math.floor(Math.max(0, n) / 2);
  const vigor = resolveAttr(actor, "vigor").value;
  const mente = resolveAttr(actor, "mente").value;

  // --- PV: limitado pelo nível de ferimento ---
  let hpGain = vigor;
  if (level) {
    if (level.restHp === 0) hpGain = 0;
    else if (typeof level.restHp === "number") hpGain = level.restHp;
  }
  // Local inapropriado: metade de tudo o que recuperaria.
  if (!proper) hpGain = half(hpGain);
  const hpBefore = hp.value || 0;
  const hpAfter = Math.min(hp.max || 0, hpBefore + hpGain);

  // --- PM e Pontos Heroicos (o nível de ferimento não os limita) ---
  const mpGainFull = Math.max(0, Math.min((mp.max || 0) - (mp.value || 0), mente));
  const mpGain = proper ? mpGainFull : half(mpGainFull);
  const phGainFull = Math.max(0, (ph.max || 0) - (ph.value || 0));
  const phGain = proper ? phGainFull : half(phGainFull);

  const update = {
    "system.resources.hp.value": hpAfter,
    "system.resources.mp.value": (mp.value || 0) + mpGain,
    "system.resources.heroic.value": (ph.value || 0) + phGain,
  };
  await actor.update(update);

  const newLevel = woundLevelFor(hpAfter);

  // --- Relatório no chat ---
  const linhas = [
    `<div>PV: ${hpBefore} → <strong>${hpAfter}</strong>/${hp.max || 0}${hpGain ? ` <span class="lig-atk-heal">(+${hpGain})</span>` : ""}</div>`,
    `<div>PM: ${mp.value || 0} → <strong>${(mp.value || 0) + mpGain}</strong>/${mp.max || 0}${mpGain ? ` <span class="lig-atk-heal">(+${mpGain})</span>` : ""}</div>`,
    `<div>Pontos Heroicos: ${ph.value || 0} → <strong>${(ph.value || 0) + phGain}</strong>/${ph.max || 0}${phGain ? ` <span class="lig-atk-heal">(+${phGain})</span>` : ""}</div>`,
  ];
  const notas = [];
  if (!proper) notas.push("local inapropriado: metade da recuperação");
  if (level && level.restHp === 0) notas.push(`${level.label}: não recupera PV com descanso`);
  else if (level && typeof level.restHp === "number") notas.push(`${level.label}: recupera apenas ${level.restHp} PV`);
  if (newLevel && newLevel.key !== "leve") notas.push(`ainda em ${newLevel.label}`);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong> descansou por 8 horas.</div>` +
      `<div class="lig-rest-report">${linhas.join("")}</div>` +
      (notas.length ? `<div class="lig-cond-note">${notas.join(" · ")}</div>` : ""),
  });

  return { hpGain, mpGain, phGain, hpAfter, level: newLevel?.key ?? null };
}
