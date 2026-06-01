/* ===================================================================
   LA TABLE DES STRATÈGES — script.js  v4.0
   Moteur Chess.com live · Badges automatiques · Admin localStorage
   =================================================================== */

'use strict';

/* ════════════════════════════════════════════════════════════════════
   CONSTANTES
   ════════════════════════════════════════════════════════════════════ */
const API          = 'https://api.chess.com/pub/player';
const ADMIN_PASS   = 'admin123';
const LS_JOUEURS   = 'tds_joueurs';     // localStorage : liste des pseudos
const LS_ANNONCES  = 'tds_annonces';    // localStorage : annonces publiées
const LS_SESSION   = 'tds_admin_auth';  // localStorage : session admin

/* Seuils badges */
const SEUIL_FEU    = 50;
const SEUIL_PALIER = 100;

/* ════════════════════════════════════════════════════════════════════
   ÉTAT GLOBAL
   ════════════════════════════════════════════════════════════════════ */
let JOUEURS_ENRICHIS = [];  // Données complètes après enrichissement API
let cadenceActive    = 'rapide';
let chargementEnCours = false;

/* ════════════════════════════════════════════════════════════════════
   UTILITAIRES GÉNÉRAUX
   ════════════════════════════════════════════════════════════════════ */

/** Génère les initiales d'un pseudo (ex: "le_maitre226" → "LM") */
function initiales(pseudo) {
  const propre = pseudo.replace(/[_\-\.]/g, ' ').trim();
  const mots   = propre.split(/\s+/).filter(Boolean);
  if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
  return propre.slice(0, 2).toUpperCase();
}

/** Construit le HTML d'un avatar : photo Chess.com ou fallback initiales */
function avatarHTML(imgUrl, pseudo) {
  const ini = initiales(pseudo);
  if (imgUrl) {
    return `
      <img src="${imgUrl}" alt="${pseudo}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <span class="avatar-initials" style="display:none;">${ini}</span>`;
  }
  return `<span class="avatar-initials">${ini}</span>`;
}

/** Format numéro de mois sur 2 chiffres (1 → "01") */
function pad2(n) { return String(n).padStart(2, '0'); }

/** Format date lisible FR */
function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Format date courte FR */
function formatDateCourt(dateStr) {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Met à jour le point de statut API dans l'interface */
function setApiStatus(etat, texte) {
  document.querySelectorAll('.api-status-dot').forEach(d => {
    d.className = `api-status-dot ${etat}`;
  });
  document.querySelectorAll('#api-status-text').forEach(s => {
    s.textContent = texte;
  });
}

/* ════════════════════════════════════════════════════════════════════
   PERSISTANCE localStorage
   ════════════════════════════════════════════════════════════════════ */

/**
 * Charge la liste des pseudos Chess.com.
 * Priorité : localStorage (modifiable par l'admin) → data.json (seed initial).
 */
async function chargerListeJoueurs() {
  const sauvegarde = localStorage.getItem(LS_JOUEURS);
  if (sauvegarde) {
    try { return JSON.parse(sauvegarde); } catch(_) {}
  }
  /* Première visite : lire data.json et persister */
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('data.json introuvable');
  const liste = await res.json(); // [{ pseudo_chesscom: "..." }, ...]
  localStorage.setItem(LS_JOUEURS, JSON.stringify(liste));
  return liste;
}

function sauvegarderListeJoueurs(liste) {
  localStorage.setItem(LS_JOUEURS, JSON.stringify(liste));
}

function chargerAnnonces() {
  try { return JSON.parse(localStorage.getItem(LS_ANNONCES)) || []; }
  catch(_) { return []; }
}

function sauvegarderAnnonces(liste) {
  localStorage.setItem(LS_ANNONCES, JSON.stringify(liste));
}

/* ════════════════════════════════════════════════════════════════════
   APPELS API CHESS.COM
   ════════════════════════════════════════════════════════════════════ */

/**
 * Récupère les stats Elo d'un joueur depuis Chess.com.
 * Renvoie { rapide, blitz, bullet } ou null si erreur.
 */
async function fetchStats(pseudo) {
  const res = await fetch(`${API}/${pseudo}/stats`);
  if (!res.ok) return null;
  const s = await res.json();
  return {
    rapide: s?.chess_rapid?.last?.rating  ?? null,
    blitz:  s?.chess_blitz?.last?.rating  ?? null,
    bullet: s?.chess_bullet?.last?.rating ?? null,
  };
}

/**
 * Récupère le profil (avatar) d'un joueur.
 * Renvoie l'URL de l'avatar ou null.
 */
async function fetchProfil(pseudo) {
  const res = await fetch(`${API}/${pseudo}`);
  if (!res.ok) return null;
  const p = await res.json();
  return p?.avatar ?? null;
}

/**
 * Récupère les parties du mois en cours pour un joueur.
 * Endpoint : /games/[AAAA]/[MM]
 * Renvoie un tableau de parties ou [].
 */
async function fetchPartiesMois(pseudo) {
  const now  = new Date();
  const an   = now.getFullYear();
  const mois = pad2(now.getMonth() + 1);
  const res  = await fetch(`${API}/${pseudo}/games/${an}/${mois}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data?.games ?? [];
}

/**
 * Analyse les parties du mois pour extraire :
 * - ref_mois  : Elo juste avant la 1ère partie du mois (selon la cadence)
 * - nb_parties: Nombre de parties jouées dans la cadence demandée
 *
 * Chess.com encode les parties avec time_class : "rapid" | "blitz" | "bullet"
 * et les Elo dans white.rating / black.rating selon la couleur du joueur.
 */
function analyserPartiesMois(parties, pseudo, cadence) {
  /* Mapping cadence FR → time_class Chess.com */
  const TC_MAP = { rapide: 'rapid', blitz: 'blitz', bullet: 'bullet' };
  const timeClass = TC_MAP[cadence] ?? 'rapid';

  /* Filtrer uniquement les parties de la cadence choisie */
  const filtrees = parties.filter(p => p.time_class === timeClass);

  if (filtrees.length === 0) {
    return { ref_mois: null, nb_parties: 0 };
  }

  /* Trier par date croissante (end_time est un timestamp Unix) */
  const triees = [...filtrees].sort((a, b) => a.end_time - b.end_time);

  /* Trouver la couleur du joueur dans la première partie */
  const premiere = triees[0];
  const pseudoLower = pseudo.toLowerCase();
  let eloAvant = null;

  if (premiere.white?.username?.toLowerCase() === pseudoLower) {
    eloAvant = premiere.white.rating ?? null;
  } else if (premiere.black?.username?.toLowerCase() === pseudoLower) {
    eloAvant = premiere.black.rating ?? null;
  }

  return {
    ref_mois:   eloAvant,
    nb_parties: filtrees.length,
  };
}

/* ════════════════════════════════════════════════════════════════════
   ENRICHISSEMENT COMPLET D'UN JOUEUR
   Appels parallèles : stats + profil + parties
   ════════════════════════════════════════════════════════════════════ */
async function enrichirJoueur(pseudo) {
  /* Lancer les 3 appels simultanément */
  const [statsRes, avatarUrl, parties] = await Promise.all([
    fetchStats(pseudo).catch(() => null),
    fetchProfil(pseudo).catch(() => null),
    fetchPartiesMois(pseudo).catch(() => []),
  ]);

  /* Elos actuels */
  const elo = {
    rapide: statsRes?.rapide ?? null,
    blitz:  statsRes?.blitz  ?? null,
    bullet: statsRes?.bullet ?? null,
  };

  /* Analyse des parties pour chaque cadence */
  const analyses = {
    rapide: analyserPartiesMois(parties, pseudo, 'rapide'),
    blitz:  analyserPartiesMois(parties, pseudo, 'blitz'),
    bullet: analyserPartiesMois(parties, pseudo, 'bullet'),
  };

  /* Progression = Elo actuel - Elo de référence début de mois */
  const progression = {};
  ['rapide', 'blitz', 'bullet'].forEach(c => {
    const actuel = elo[c];
    const ref    = analyses[c].ref_mois;
    progression[c] = (actuel !== null && ref !== null) ? actuel - ref : null;
  });

  /* Nombre de parties total toutes cadences confondues */
  const nb_parties_total =
    analyses.rapide.nb_parties +
    analyses.blitz.nb_parties  +
    analyses.bullet.nb_parties;

  return {
    pseudo,
    avatarUrl,
    elo,
    ref_mois: {
      rapide: analyses.rapide.ref_mois,
      blitz:  analyses.blitz.ref_mois,
      bullet: analyses.bullet.ref_mois,
    },
    nb_parties: {
      rapide: analyses.rapide.nb_parties,
      blitz:  analyses.blitz.nb_parties,
      bullet: analyses.bullet.nb_parties,
      total:  nb_parties_total,
    },
    progression,
  };
}

/**
 * Charge et enrichit tous les joueurs de la liste.
 * Affiche la progression dans la barre de statut.
 */
async function chargerTousLesJoueurs() {
  if (chargementEnCours) return;
  chargementEnCours = true;
  setApiStatus('loading', 'Synchronisation Chess.com…');

  const liste = await chargerListeJoueurs();
  const total = liste.length;
  let ok = 0;

  /* Enrichissement en parallèle (limité à 4 simultanés pour éviter le rate-limit) */
  const resultats = [];
  const BATCH = 4;
  for (let i = 0; i < liste.length; i += BATCH) {
    const tranche = liste.slice(i, i + BATCH);
    const batch   = await Promise.allSettled(
      tranche.map(j => enrichirJoueur(j.pseudo_chesscom))
    );
    batch.forEach(r => {
      if (r.status === 'fulfilled') {
        resultats.push(r.value);
        ok++;
        setApiStatus('loading', `${ok} / ${total} joueurs chargés…`);
      } else {
        console.warn('[TDS] Échec enrichissement :', r.reason);
      }
    });
  }

  JOUEURS_ENRICHIS = resultats;
  setApiStatus('ok', `${ok} joueur${ok > 1 ? 's' : ''} synchronisé${ok > 1 ? 's' : ''}`);
  chargementEnCours = false;
  return JOUEURS_ENRICHIS;
}

/* ════════════════════════════════════════════════════════════════════
   LOGIQUE BADGES — ENTIÈREMENT AUTOMATIQUE
   ════════════════════════════════════════════════════════════════════ */
function calculerBadges(joueur, cadence, rankIndex) {
  const badges = [];
  const delta  = joueur.progression[cadence];  // peut être null
  const parties = joueur.nb_parties[cadence];

  /* 💤 Inactif : 0 partie ce mois dans cette cadence */
  if (parties === 0) {
    badges.push({ emoji: '💤', titre: 'Aucune partie jouée ce mois' });
    return badges; // Pas d'autres badges si inactif
  }

  /* 👑 Leader : rang #1 du classement actif */
  if (rankIndex === 0) {
    badges.push({ emoji: '👑', titre: 'Leader du classement' });
  }

  if (delta !== null) {
    /* 🎯 Palier (+100 ou plus) — affiché EN PLUS de 🔥 */
    if (delta >= SEUIL_PALIER) {
      badges.push({ emoji: '🔥', titre: `En feu ! +${delta} Elo ce mois` });
      badges.push({ emoji: '🎯', titre: `Progression exceptionnelle : +${delta} Elo` });
    }
    /* 🔥 En feu (+50 à +99) */
    else if (delta >= SEUIL_FEU) {
      badges.push({ emoji: '🔥', titre: `En feu ! +${delta} Elo ce mois` });
    }
  }

  return badges;
}

function renderBadges(badges) {
  return badges.map(b =>
    `<span class="badge" title="${b.titre}">${b.emoji}</span>`
  ).join('');
}

/* ════════════════════════════════════════════════════════════════════
   TRI DES JOUEURS
   ════════════════════════════════════════════════════════════════════ */
function trierJoueurs(joueurs, cadence) {
  return [...joueurs].sort((a, b) => {
    const eA = a.elo[cadence] ?? 0;
    const eB = b.elo[cadence] ?? 0;
    return eB - eA;
  });
}

/* ════════════════════════════════════════════════════════════════════
   AFFICHAGE LOADER
   ════════════════════════════════════════════════════════════════════ */
function showLoaderPodium() {
  const c = document.getElementById('podium-container');
  if (c) c.innerHTML = `
    <div class="api-loader" style="grid-column:1/-1;">
      <div class="spinner"></div><p>Connexion à Chess.com…</p>
    </div>`;
}

function showLoaderTableau() {
  const tb = document.getElementById('classement-table-body');
  if (tb) tb.innerHTML = `
    <tr><td colspan="6" style="text-align:center;padding:48px;">
      <div class="api-loader"><div class="spinner"></div><p>Connexion à Chess.com…</p></div>
    </td></tr>`;
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ACCUEIL — Podium 3D
   ════════════════════════════════════════════════════════════════════ */
function renderPodium(joueurs) {
  const container = document.getElementById('podium-container');
  if (!container) return;

  const cadences = [
    { key: 'rapide', label: 'Rapide', icon: '⏱️' },
    { key: 'blitz',  label: 'Blitz',  icon: '⚡'  },
    { key: 'bullet', label: 'Bullet', icon: '🔫'  },
  ];

  container.innerHTML = cadences.map(c => {
    const tries = trierJoueurs(joueurs, c.key);
    const p1 = tries[0], p2 = tries[1], p3 = tries[2];
    if (!p1) return '';

    const col = (joueur, rang) => {
      if (!joueur) return `<div class="podium-col rank-${rang}"></div>`;
      const delta    = joueur.progression[c.key];
      const deltaTxt = delta === null ? '—' : delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`;
      const deltaCls = delta === null ? 'zero' : delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
      /* Badge sur le podium : seulement Leader + En feu */
      const badges   = calculerBadges(joueur, c.key, rang - 1);
      const badgesHtml = badges.length ? `<div style="font-size:16px;line-height:1;margin-top:2px;">${badges.map(b=>`<span title="${b.titre}">${b.emoji}</span>`).join('')}</div>` : '';

      return `
        <div class="podium-col rank-${rang}">
          <div class="podium-player-card">
            <div class="podium-avatar-3d">${avatarHTML(joueur.avatarUrl, joueur.pseudo)}</div>
            <div class="podium-pseudo-3d">${joueur.pseudo}</div>
            <div class="podium-elo-3d">${joueur.elo[c.key] ?? '—'}</div>
            ${badgesHtml}
            <span class="podium-delta ${deltaCls}">${deltaTxt} Elo</span>
          </div>
          <div class="podium-step">
            <span class="podium-step-num">${rang}</span>
          </div>
        </div>`;
    };

    return `
      <div class="podium-bloc">
        <div class="podium-cadence-header">
          <span class="podium-cadence-name">${c.label}</span>
          <span class="podium-cadence-icon">${c.icon}</span>
        </div>
        <div class="podium-scene">
          ${col(p2, 2)}
          ${col(p1, 1)}
          ${col(p3, 3)}
        </div>
      </div>`;
  }).join('');
}

/* ── Champion du Club ── */
function renderChampionnat(joueurs) {
  const container = document.getElementById('championnat-container');
  if (!container) return;

  /* Le champion = #1 du classement Rapide */
  const tries  = trierJoueurs(joueurs, 'rapide');
  const champ  = tries[0];
  if (!champ) return;

  container.innerHTML = `
    <div class="championship-block">
      <div class="champ-slot">
        <span class="champ-label">👑 Tenant du Titre</span>
        <div class="champ-avatar-big champion-pulse">${avatarHTML(champ.avatarUrl, champ.pseudo)}</div>
        <div>
          <div class="champ-pseudo">${champ.pseudo}</div>
          <div class="champ-elo">${champ.elo.rapide ?? '—'} Elo (Rapide)</div>
        </div>
      </div>
      <div class="champ-separator">
        <div class="champ-vs-line"></div>
        <div class="champ-vs">VS</div>
        <div class="champ-vs-line"></div>
      </div>
      <div class="champ-slot challenger-slot">
        <span class="champ-label" style="color:rgba(255,255,255,.3);border-color:rgba(255,255,255,.1);">⚔️ Challenger</span>
        <div class="challenger-avatar">❓</div>
        <p class="challenger-text">À déterminer via le<br><em>Tournoi des Candidats<br>en cours</em></p>
        <span class="challenger-tag">⚔️ En cours de sélection</span>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   PAGE CLASSEMENT — Tableau enrichi 6 colonnes
   ════════════════════════════════════════════════════════════════════ */
function renderClassement(joueurs, cadence) {
  const tbody = document.getElementById('classement-table-body');
  if (!tbody) return;
  const tries = trierJoueurs(joueurs, cadence);

  const rankHtml = (i) => {
    if (i === 0) return `<span class="rank-cell rank-gold">♚</span>`;
    if (i === 1) return `<span class="rank-cell rank-silver">2</span>`;
    if (i === 2) return `<span class="rank-cell rank-bronze">3</span>`;
    return `<span class="rank-cell">${i + 1}</span>`;
  };

  tbody.innerHTML = tries.map((j, i) => {
    const eloActuel  = j.elo[cadence] ?? '—';
    const refMois    = j.ref_mois[cadence] ?? '—';
    const delta      = j.progression[cadence];
    const parties    = j.nb_parties[cadence];
    const badges     = calculerBadges(j, cadence, i);

    const deltaTxt   = delta === null ? '—' : delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`;
    const progrCls   = delta === null ? 'progr-zero' : delta > 0 ? 'progr-pos' : delta < 0 ? 'progr-neg' : 'progr-zero';

    return `
      <tr data-pseudo="${j.pseudo.toLowerCase()}">
        <td>${rankHtml(i)}</td>
        <td>
          <div class="player-cell">
            <div class="table-avatar">${avatarHTML(j.avatarUrl, j.pseudo)}</div>
            <div>
              <div class="table-pseudo">${j.pseudo}</div>
              <div class="badges-row">${renderBadges(badges)}</div>
            </div>
          </div>
        </td>
        <td><span class="elo-cell">${eloActuel}</span></td>
        <td><span class="ref-cell">${refMois}</span></td>
        <td><span class="progr-cell"><span class="progr-badge ${progrCls}">${deltaTxt}</span></span></td>
        <td><span class="parties-cell">${parties}</span></td>
      </tr>`;
  }).join('');
}

function filtrerTableau() {
  const q = (document.getElementById('search-joueur')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#classement-table-body tr').forEach(tr => {
    const pseudo = tr.dataset.pseudo || '';
    tr.classList.toggle('hidden', q.length > 0 && !pseudo.includes(q));
  });
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ANNONCES (depuis localStorage)
   ════════════════════════════════════════════════════════════════════ */
function renderAnnonces() {
  const container = document.getElementById('annonces-container');
  if (!container) return;

  const annonces = chargerAnnonces();

  const catConfig = {
    important: { label: '🔴 IMPORTANT',   cls: 'badge-important', cardCls: 'cat-important' },
    duel:      { label: '⚔️ DUEL / CHOC',  cls: 'badge-duel',      cardCls: 'cat-duel'      },
    tournoi:   { label: '🏆 TOURNOI',      cls: 'badge-tournoi',   cardCls: 'cat-tournoi'   },
  };

  if (!annonces.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:64px 40px;color:var(--gris-moyen);">
        <div style="font-size:40px;margin-bottom:16px;">📋</div>
        <p style="font-family:var(--font-titre);font-size:1.3rem;font-style:italic;">
          Aucune annonce pour le moment.
        </p>
        <p style="font-size:13px;margin-top:8px;">Les communications officielles apparaîtront ici.</p>
      </div>`;
    return;
  }

  const triees = [...annonces].sort((a, b) => new Date(b.date) - new Date(a.date));

  container.innerHTML = triees.map(a => {
    const cfg = catConfig[a.categorie] || catConfig.important;
    return `
      <article class="annonce-card ${cfg.cardCls} animate-in">
        <div class="annonce-meta">
          <span class="annonce-badge ${cfg.cls}">${cfg.label}</span>
          <span class="annonce-date">${formatDateCourt(a.date)}</span>
          <span class="annonce-auteur">par <strong>Admin</strong></span>
        </div>
        <h2 class="annonce-titre">${a.titre}</h2>
        <p class="annonce-texte">${a.texte}</p>
      </article>`;
  }).join('');
}

/* ── Aperçu 2 annonces sur la page d'accueil ── */
function renderAnnoncesPreview() {
  const preview = document.getElementById('annonces-preview');
  if (!preview) return;

  const annonces = chargerAnnonces();
  const catConfig = {
    important: { label: '🔴 IMPORTANT',   cls: 'badge-important', cardCls: 'cat-important' },
    duel:      { label: '⚔️ DUEL / CHOC',  cls: 'badge-duel',      cardCls: 'cat-duel'      },
    tournoi:   { label: '🏆 TOURNOI',      cls: 'badge-tournoi',   cardCls: 'cat-tournoi'   },
  };

  if (!annonces.length) {
    preview.innerHTML = `
      <p style="color:var(--gris-moyen);font-style:italic;padding:20px 0;">
        Aucune annonce publiée pour l'instant.
      </p>`;
    return;
  }

  const deux = [...annonces].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0, 2);
  preview.innerHTML = deux.map(a => {
    const cfg = catConfig[a.categorie] || catConfig.important;
    return `
      <article class="annonce-card ${cfg.cardCls}">
        <div class="annonce-meta">
          <span class="annonce-badge ${cfg.cls}">${cfg.label}</span>
          <span class="annonce-date">${formatDateCourt(a.date)}</span>
          <span class="annonce-auteur">par <strong>Admin</strong></span>
        </div>
        <h2 class="annonce-titre">${a.titre}</h2>
        <p class="annonce-texte">${a.texte.substring(0, 160)}…</p>
      </article>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ACTIVITÉS
   ════════════════════════════════════════════════════════════════════ */
function renderJoueurDuMois(joueurs) {
  const container = document.getElementById('jdm-container');
  if (!container) return;

  /* Meilleure progression toutes cadences */
  let meilleur = null, maxDelta = -Infinity, meilleureC = 'rapide';
  joueurs.forEach(j => {
    ['rapide', 'blitz', 'bullet'].forEach(c => {
      const d = j.progression[c];
      if (d !== null && d > maxDelta) { maxDelta = d; meilleur = j; meilleureC = c; }
    });
  });

  if (!meilleur || maxDelta <= 0) {
    container.innerHTML = `
      <div style="background:var(--noir);border:1px solid rgba(184,146,74,.2);border-radius:4px;padding:40px;text-align:center;color:rgba(255,255,255,.4);font-style:italic;">
        Aucune progression positive enregistrée ce mois-ci.
      </div>`;
    return;
  }

  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  container.innerHTML = `
    <div class="joueur-du-mois animate-in">
      <div class="jdm-avatar">${avatarHTML(meilleur.avatarUrl, meilleur.pseudo)}</div>
      <div class="jdm-content">
        <div class="jdm-crown">✦ Joueur du Mois — ${mois} ✦</div>
        <div class="jdm-pseudo">${meilleur.pseudo}</div>
        <div class="jdm-gain"><span>+${maxDelta}</span> Elo en ${meilleureC} ce mois-ci 🚀</div>
        <p style="color:rgba(255,255,255,.45);font-size:14px;margin-top:12px;">
          ${meilleur.nb_parties[meilleureC]} partie${meilleur.nb_parties[meilleureC]>1?'s':''} jouée${meilleur.nb_parties[meilleureC]>1?'s':''} · ${meilleureC.charAt(0).toUpperCase()+meilleureC.slice(1)}
        </p>
      </div>
    </div>`;
}

function renderFluxActivite(joueurs) {
  const container = document.getElementById('flux-activite');
  if (!container) return;
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  const msgs = [];

  joueurs.forEach(j => {
    /* Inactif si 0 partie toutes cadences confondues */
    if (j.nb_parties.total === 0) {
      msgs.push({ icon: '💤', text: `<strong>${j.pseudo}</strong> n'a joué aucune partie ce mois. L'échiquier attend son retour…`, time: `Ce mois de ${mois}` });
      return;
    }
    ['rapide', 'blitz', 'bullet'].forEach(c => {
      const d = j.progression[c];
      if (d === null) return;
      if (d >= SEUIL_PALIER)
        msgs.push({ icon: '🎯', text: `<strong>${j.pseudo}</strong> réalise une progression exceptionnelle en ${c} : <strong>+${d} Elo</strong> !`, time: `Ce mois de ${mois}` });
      else if (d >= SEUIL_FEU)
        msgs.push({ icon: '🔥', text: `<strong>${j.pseudo}</strong> est <strong>en feu</strong> en ${c} : <strong>+${d} Elo</strong> ce mois !`, time: `Ce mois de ${mois}` });
    });
  });

  if (!msgs.length)
    msgs.push({ icon: '♟️', text: 'Les stratèges préparent leur prochain coup en silence.', time: `Ce mois de ${mois}` });

  container.innerHTML = msgs.map(m => `
    <div class="activity-item animate-in">
      <span class="activity-icon">${m.icon}</span>
      <div>
        <div class="activity-text">${m.text}</div>
        <div class="activity-time">${m.time}</div>
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ADMIN — Panneau complet lié au localStorage
   ════════════════════════════════════════════════════════════════════ */
function initAdmin() {
  const loginSection  = document.getElementById('admin-login-section');
  const panneauSection = document.getElementById('admin-panneau');
  if (!loginSection) return;  // Pas sur la page admin

  /* Vérifier session persistante */
  if (sessionStorage.getItem(LS_SESSION) === '1') {
    afficherPanneau();
  }

  /* Bouton de connexion */
  const btnLogin   = document.getElementById('btn-admin-login');
  const passInput  = document.getElementById('admin-pass');
  const msgEl      = document.getElementById('admin-msg');

  const tenterConnexion = () => {
    if (passInput.value === ADMIN_PASS) {
      sessionStorage.setItem(LS_SESSION, '1');
      afficherPanneau();
    } else {
      msgEl.textContent = '✗ Mot de passe incorrect.';
      msgEl.style.color = 'var(--rouge)';
      passInput.value = '';
      passInput.focus();
    }
  };

  btnLogin?.addEventListener('click', tenterConnexion);
  passInput?.addEventListener('keydown', e => { if (e.key === 'Enter') tenterConnexion(); });

  /* Déconnexion */
  document.getElementById('btn-deconnexion')?.addEventListener('click', () => {
    sessionStorage.removeItem(LS_SESSION);
    location.reload();
  });
}

function afficherPanneau() {
  const loginSection  = document.getElementById('admin-login-section');
  const panneauSection = document.getElementById('admin-panneau');
  if (loginSection)   loginSection.style.display  = 'none';
  if (panneauSection) panneauSection.style.display = 'block';
  renderAdminJoueurs();
  renderAdminAnnonces();
  bindAdminForms();
}

/* ── Rendu de la liste des joueurs dans le panneau admin ── */
function renderAdminJoueurs() {
  const liste    = JSON.parse(localStorage.getItem(LS_JOUEURS) || '[]');
  const container = document.getElementById('admin-liste-joueurs');
  if (!container) return;

  if (!liste.length) {
    container.innerHTML = `<p style="color:var(--gris-moyen);font-style:italic;padding:12px 0;">Aucun joueur enregistré.</p>`;
    return;
  }

  container.innerHTML = liste.map((j, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:12px 16px;border:1px solid var(--gris-clair);border-radius:4px;
                background:#fff;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:18px;">♟</span>
        <div>
          <div style="font-weight:600;font-size:14px;color:var(--noir);">${j.pseudo_chesscom}</div>
          <a href="https://www.chess.com/member/${j.pseudo_chesscom}" target="_blank" rel="noopener"
             style="font-size:11px;color:var(--bleu);">chess.com/member/${j.pseudo_chesscom} ↗</a>
        </div>
      </div>
      <button onclick="supprimerJoueur(${i})"
              style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
                     padding:6px 14px;border-radius:4px;border:none;cursor:pointer;
                     background:#FDE9EA;color:var(--rouge);transition:var(--transition);"
              onmouseover="this.style.background='var(--rouge)';this.style.color='#fff';"
              onmouseout="this.style.background='#FDE9EA';this.style.color='var(--rouge)';">
        ✕ Supprimer
      </button>
    </div>`).join('');
}

/** Supprime un joueur par index et recharge la liste */
window.supprimerJoueur = function(index) {
  const liste = JSON.parse(localStorage.getItem(LS_JOUEURS) || '[]');
  if (!confirm(`Supprimer "${liste[index]?.pseudo_chesscom}" du club ?`)) return;
  liste.splice(index, 1);
  sauvegarderListeJoueurs(liste);
  renderAdminJoueurs();
  flash('admin-flash', '✓ Joueur supprimé.', 'vert');
};

/* ── Rendu de la liste des annonces dans le panneau admin ── */
function renderAdminAnnonces() {
  const annonces  = chargerAnnonces();
  const container = document.getElementById('admin-liste-annonces');
  if (!container) return;

  if (!annonces.length) {
    container.innerHTML = `<p style="color:var(--gris-moyen);font-style:italic;padding:12px 0;">Aucune annonce publiée.</p>`;
    return;
  }

  const triees = [...annonces].sort((a,b) => new Date(b.date)-new Date(a.date));
  container.innerHTML = triees.map((a, i) => `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
                padding:14px 16px;border:1px solid var(--gris-clair);border-radius:4px;
                background:#fff;margin-bottom:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
                    color:var(--gris-moyen);margin-bottom:4px;">${formatDateCourt(a.date)} · ${a.categorie.toUpperCase()}</div>
        <div style="font-family:var(--font-titre);font-size:1.1rem;font-weight:600;color:var(--noir);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.titre}</div>
      </div>
      <button onclick="supprimerAnnonce('${a.id}')"
              style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
                     padding:6px 14px;border-radius:4px;border:none;cursor:pointer;flex-shrink:0;
                     background:#FDE9EA;color:var(--rouge);transition:var(--transition);"
              onmouseover="this.style.background='var(--rouge)';this.style.color='#fff';"
              onmouseout="this.style.background='#FDE9EA';this.style.color='var(--rouge)';">
        ✕ Supprimer
      </button>
    </div>`).join('');
}

/** Supprime une annonce par ID */
window.supprimerAnnonce = function(id) {
  let annonces = chargerAnnonces();
  if (!confirm('Supprimer cette annonce ?')) return;
  annonces = annonces.filter(a => a.id !== id);
  sauvegarderAnnonces(annonces);
  renderAdminAnnonces();
  flash('admin-flash', '✓ Annonce supprimée.', 'vert');
};

/* ── Liaison des formulaires admin ── */
function bindAdminForms() {

  /* Formulaire AJOUTER un joueur */
  document.getElementById('form-ajouter-joueur')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('input-pseudo-joueur');
    const pseudo = input.value.trim().toLowerCase();
    if (!pseudo) return;

    const liste = JSON.parse(localStorage.getItem(LS_JOUEURS) || '[]');
    if (liste.some(j => j.pseudo_chesscom.toLowerCase() === pseudo)) {
      flash('admin-flash', '⚠ Ce joueur est déjà dans la liste.', 'rouge');
      return;
    }
    liste.push({ pseudo_chesscom: pseudo });
    sauvegarderListeJoueurs(liste);
    input.value = '';
    renderAdminJoueurs();
    flash('admin-flash', `✓ "${pseudo}" ajouté au club.`, 'vert');
  });

  /* Formulaire CRÉER une annonce */
  document.getElementById('form-creer-annonce')?.addEventListener('submit', e => {
    e.preventDefault();
    const titre     = document.getElementById('annonce-titre').value.trim();
    const texte     = document.getElementById('annonce-texte').value.trim();
    const categorie = document.getElementById('annonce-categorie').value;

    if (!titre || !texte) {
      flash('admin-flash', '⚠ Titre et contenu sont obligatoires.', 'rouge');
      return;
    }

    const annonces = chargerAnnonces();
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
    const nouvelleAnnonce = {
      id:         `ann_${Date.now()}`,
      date:       dateStr,
      titre,
      texte,
      categorie,
    };
    annonces.push(nouvelleAnnonce);
    sauvegarderAnnonces(annonces);

    /* Réinitialiser le formulaire */
    document.getElementById('annonce-titre').value = '';
    document.getElementById('annonce-texte').value = '';
    document.getElementById('annonce-categorie').value = 'important';

    renderAdminAnnonces();
    flash('admin-flash', '✓ Annonce publiée. Elle apparaît sur le site.', 'vert');
  });

  /* Réinitialisation complète (bouton danger) */
  document.getElementById('btn-reset-data')?.addEventListener('click', () => {
    if (!confirm('⚠ Cette action supprime TOUS les joueurs et annonces. Continuer ?')) return;
    localStorage.removeItem(LS_JOUEURS);
    localStorage.removeItem(LS_ANNONCES);
    flash('admin-flash', '✓ Données réinitialisées. Rechargez le site.', 'vert');
    setTimeout(() => location.reload(), 1500);
  });
}

/** Affiche un message flash temporaire dans le panneau admin */
function flash(id, message, couleur) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.style.color = couleur === 'vert' ? 'var(--vert)' : 'var(--rouge)';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

/* ════════════════════════════════════════════════════════════════════
   NAVBAR MOBILE — Hamburger
   ════════════════════════════════════════════════════════════════════ */
function initNavbar() {
  const toggle = document.getElementById('navbar-toggle');
  const nav    = document.getElementById('navbar-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    nav.classList.contains('open') ? fermerMenu(nav, toggle) : ouvrirMenu(nav, toggle);
  });
  document.addEventListener('click', e => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target))
      fermerMenu(nav, toggle);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { fermerMenu(nav, toggle); toggle.focus(); }
  });
  nav.querySelectorAll('a').forEach(l => l.addEventListener('click', () => fermerMenu(nav, toggle)));
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && nav.classList.contains('open')) fermerMenu(nav, toggle);
  });
}

function ouvrirMenu(nav, toggle) {
  nav.classList.add('open');
  toggle.textContent = '✕';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Fermer le menu');
  document.body.style.overflow = 'hidden';
}
function fermerMenu(nav, toggle) {
  nav.classList.remove('open');
  toggle.textContent = '☰';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Ouvrir le menu');
  document.body.style.overflow = '';
}

/* ════════════════════════════════════════════════════════════════════
   UTILITAIRES PAGE
   ════════════════════════════════════════════════════════════════════ */
function marquerLienActif() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.navbar-nav a').forEach(link => {
    if (link.getAttribute('href') === page || (page === '' && link.getAttribute('href') === 'index.html'))
      link.classList.add('active');
  });
}

function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.annonce-card, .activity-item, .hall-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity .5s ease, transform .5s ease';
    obs.observe(el);
  });
}

/* ════════════════════════════════════════════════════════════════════
   ORCHESTRATION PAR PAGE
   ════════════════════════════════════════════════════════════════════ */
async function initAccueil() {
  if (!document.getElementById('podium-container')) return;
  showLoaderPodium();
  renderAnnoncesPreview();
  try {
    await chargerTousLesJoueurs();
    renderPodium(JOUEURS_ENRICHIS);
    renderChampionnat(JOUEURS_ENRICHIS);
    const statEl = document.getElementById('stat-joueurs');
    if (statEl) statEl.textContent = JOUEURS_ENRICHIS.length;
  } catch(err) {
    console.error('[Accueil]', err);
    setApiStatus('error', 'Erreur de connexion');
  }
}

async function initClassement() {
  if (!document.getElementById('classement-table-body')) return;
  showLoaderTableau();

  const reload = async () => {
    const btnR = document.getElementById('btn-refresh');
    if (chargementEnCours) return;
    btnR?.classList.add('spinning');
    try {
      await chargerTousLesJoueurs();
      renderClassement(JOUEURS_ENRICHIS, cadenceActive);
      filtrerTableau();
    } catch(err) {
      console.error('[Classement]', err);
      setApiStatus('error', 'Erreur Chess.com');
    } finally {
      btnR?.classList.remove('spinning');
    }
  };

  document.getElementById('btn-refresh')?.addEventListener('click', reload);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cadenceActive = btn.dataset.cadence;
      if (JOUEURS_ENRICHIS.length) { renderClassement(JOUEURS_ENRICHIS, cadenceActive); filtrerTableau(); }
    });
  });

  document.getElementById('search-joueur')?.addEventListener('input', filtrerTableau);

  await reload();
}

function initAnnonces() {
  if (!document.getElementById('annonces-container')) return;
  renderAnnonces();
}

async function initActivites() {
  if (!document.getElementById('jdm-container')) return;
  try {
    await chargerTousLesJoueurs();
    renderJoueurDuMois(JOUEURS_ENRICHIS);
    renderFluxActivite(JOUEURS_ENRICHIS);
  } catch(err) {
    console.error('[Activités]', err);
  }
}

/* ════════════════════════════════════════════════════════════════════
   POINT D'ENTRÉE
   ════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  marquerLienActif();
  initAccueil();
  initClassement();
  initAnnonces();
  initActivites();
  initAdmin();
  setTimeout(initScrollAnimations, 300);
});
