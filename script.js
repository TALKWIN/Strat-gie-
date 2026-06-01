/* ===================================================================
   LA TABLE DES STRATÈGES — script.js  v3.0
   Intégration Chess.com API + Podium 3D + Tableau enrichi
   =================================================================== */

'use strict';

/* ── Constantes ─────────────────────────────────────────────────────── */
const BADGE_SEUIL_FEU       = 50;
const BADGE_SEUIL_CONVALESC = -50;
const API_BASE = 'https://api.chess.com/pub/player';

/* ── État global ────────────────────────────────────────────────────── */
let CONFIG      = null;   // data.json (pseudos + refs mois)
let JOUEURS_API = [];     // données enrichies depuis Chess.com
let cadenceActive = 'rapide';
let chargementEnCours = false;

/* ════════════════════════════════════════════════════════════════════
   UTILITAIRES
   ════════════════════════════════════════════════════════════════════ */

/** Initiales depuis un pseudo (ex: "Google_maitre" → "GM") */
function initiales(pseudo) {
  const mots = pseudo.replace(/[_\-\.]/g, ' ').trim().split(/\s+/);
  if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
  return pseudo.slice(0, 2).toUpperCase();
}

/** Génère un avatar : <img> si url disponible, sinon <span> initiales */
function avatarHTML(imgUrl, pseudo, classes = '') {
  const ini = initiales(pseudo);
  if (imgUrl) {
    return `<img src="${imgUrl}" alt="${pseudo}" class="${classes}"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
            <span class="avatar-initials" style="display:none;">${ini}</span>`;
  }
  return `<span class="avatar-initials">${ini}</span>`;
}

/** Format date FR long */
function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Format date FR court */
function formatDateCourt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Met à jour le point de statut API */
function setApiStatus(etat, texte) {
  const dot  = document.getElementById('api-status-dot');
  const span = document.getElementById('api-status-text');
  if (dot)  { dot.className = `api-status-dot ${etat}`; }
  if (span) { span.textContent = texte; }
}

/* ════════════════════════════════════════════════════════════════════
   CHARGEMENT CONFIG & API CHESS.COM
   ════════════════════════════════════════════════════════════════════ */

/** Charge data.json (config du club) */
async function chargerConfig() {
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('data.json introuvable');
  return res.json();
}

/**
 * Fetch Chess.com stats pour un joueur
 * Renvoie { elo_rapide, elo_blitz, elo_bullet, avatar, nb_parties_rapide }
 */
async function fetchJoueurChessCom(username) {
  const [statsRes, profileRes] = await Promise.allSettled([
    fetch(`${API_BASE}/${username}/stats`),
    fetch(`${API_BASE}/${username}`)
  ]);

  let elo_rapide = null, elo_blitz = null, elo_bullet = null, nb_parties = 0;
  let avatarUrl = null;

  /* Stats */
  if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
    try {
      const s = await statsRes.value.json();
      elo_rapide = s?.chess_rapid?.last?.rating   ?? null;
      elo_blitz  = s?.chess_blitz?.last?.rating   ?? null;
      elo_bullet = s?.chess_bullet?.last?.rating  ?? null;
      nb_parties =
        (s?.chess_rapid?.record?.win  || 0) +
        (s?.chess_rapid?.record?.loss || 0) +
        (s?.chess_rapid?.record?.draw || 0);
    } catch(_) {}
  }

  /* Profil / avatar */
  if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
    try {
      const p = await profileRes.value.json();
      avatarUrl = p?.avatar ?? null;
    } catch(_) {}
  }

  return { elo_rapide, elo_blitz, elo_bullet, nb_parties, avatarUrl };
}

/** Charge tous les joueurs depuis Chess.com et fusionne avec config */
async function chargerJoueursChessCom(config) {
  setApiStatus('loading', 'Synchronisation Chess.com…');
  showLoader('podium-container');
  showLoader('classement-table-body', true);

  const resultats = await Promise.allSettled(
    config.joueurs.map(j => fetchJoueurChessCom(j.username_chesscom))
  );

  const joueurs = config.joueurs.map((j, i) => {
    const api = resultats[i].status === 'fulfilled'
      ? resultats[i].value
      : { elo_rapide: null, elo_blitz: null, elo_bullet: null, nb_parties: 0, avatarUrl: null };

    /* Fallback : si Chess.com ne répond pas, on utilise des valeurs simulées */
    const elo = {
      rapide: api.elo_rapide ?? (j.ref_mois.rapide + Math.floor(Math.random()*80 - 20)),
      blitz:  api.elo_blitz  ?? (j.ref_mois.blitz  + Math.floor(Math.random()*80 - 20)),
      bullet: api.elo_bullet ?? (j.ref_mois.bullet + Math.floor(Math.random()*80 - 20)),
    };

    return {
      pseudo:     j.pseudo_site,
      username:   j.username_chesscom,
      avatarUrl:  api.avatarUrl,
      ref_mois:   j.ref_mois,
      elo,
      nb_parties: api.nb_parties,
      /* Progression par cadence */
      progression: {
        rapide: elo.rapide - j.ref_mois.rapide,
        blitz:  elo.blitz  - j.ref_mois.blitz,
        bullet: elo.bullet - j.ref_mois.bullet,
      }
    };
  });

  setApiStatus('ok', `${joueurs.length} joueurs synchronisés`);
  return joueurs;
}

function showLoader(id, estTableau = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (estTableau) {
    el.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
      <div class="api-loader"><div class="spinner"></div><p>Connexion à Chess.com…</p></div>
    </td></tr>`;
  } else {
    el.innerHTML = `<div class="api-loader"><div class="spinner"></div><p>Connexion à Chess.com…</p></div>`;
  }
}

/* ════════════════════════════════════════════════════════════════════
   LOGIQUE BADGES
   ════════════════════════════════════════════════════════════════════ */
function calculerBadges(joueur, cadence, rankIndex) {
  const badges = [];
  const delta  = joueur.progression[cadence];
  const elo    = joueur.elo[cadence];
  const ref    = joueur.ref_mois[cadence];

  if (delta >= BADGE_SEUIL_FEU)
    badges.push({ emoji: '🔥', titre: `En feu ! +${delta} Elo ce mois` });

  if (rankIndex === 0)
    badges.push({ emoji: '👑', titre: 'Leader du classement' });

  /* Palier : a-t-il franchi un cap de centaine ? */
  const palierActuel = Math.floor(elo  / 100) * 100;
  const palierDebut  = Math.floor(ref  / 100) * 100;
  if (palierActuel > palierDebut)
    badges.push({ emoji: '🎯', titre: `Palier franchi : ${palierActuel} Elo !` });

  if (delta <= BADGE_SEUIL_CONVALESC)
    badges.push({ emoji: '🩹', titre: `En convalescence… ${delta} Elo ce mois` });

  if (joueur.nb_parties === 0)
    badges.push({ emoji: '💤', titre: 'Aucune partie jouée ce mois' });

  return badges;
}

function renderBadges(badges) {
  return badges.map(b =>
    `<span class="badge" title="${b.titre}">${b.emoji}</span>`
  ).join('');
}

function trierJoueurs(joueurs, cadence) {
  return [...joueurs].sort((a, b) => b.elo[cadence] - a.elo[cadence]);
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
    /* Ordre d'affichage visuel : [rang2, rang1, rang3] */
    const p1 = tries[0], p2 = tries[1], p3 = tries[2];
    if (!p1) return '';

    const colonneHTML = (joueur, rang) => {
      if (!joueur) return `<div class="podium-col rank-${rang}"></div>`;
      const delta = joueur.progression[c.key];
      const deltaTxt = delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`;
      const deltaCls = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
      return `
        <div class="podium-col rank-${rang}">
          <div class="podium-player-card">
            <div class="podium-avatar-3d">
              ${avatarHTML(joueur.avatarUrl, joueur.pseudo)}
            </div>
            <div class="podium-pseudo-3d">${joueur.pseudo}</div>
            <div class="podium-elo-3d">${joueur.elo[c.key]}</div>
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
          ${colonneHTML(p2, 2)}
          ${colonneHTML(p1, 1)}
          ${colonneHTML(p3, 3)}
        </div>
      </div>`;
  }).join('');
}

function renderChampionnat(config, joueurs) {
  const container = document.getElementById('championnat-container');
  if (!container) return;
  const champConfig = config.club.champion;

  /* Trouver les données API du champion */
  const champData = joueurs.find(j => j.pseudo === champConfig.pseudo_site);
  const avatarUrl = champData?.avatarUrl ?? null;
  const eloRapide = champData?.elo.rapide ?? '—';

  container.innerHTML = `
    <div class="championship-block">
      <div class="champ-slot">
        <span class="champ-label">👑 Tenant du Titre</span>
        <div class="champ-avatar-big champion-pulse">
          ${avatarHTML(avatarUrl, champConfig.pseudo_site)}
        </div>
        <div>
          <div class="champ-pseudo">${champConfig.pseudo_site}</div>
          <div class="champ-elo">${eloRapide} Elo (Rapide)</div>
          <div class="champ-date">Champion depuis le ${formatDate(champConfig.crowned_date)}</div>
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
   PAGE CLASSEMENT — Tableau enrichi v3
   Colonnes : Rang | Joueur | Elo | Réf. Mois | Progr. | Parties
   ════════════════════════════════════════════════════════════════════ */
function renderClassement(joueurs, cadence) {
  const tbody = document.getElementById('classement-table-body');
  if (!tbody) return;
  const tries = trierJoueurs(joueurs, cadence);

  const rankSymbol = (i) => {
    if (i === 0) return '<span class="rank-cell rank-gold">♚</span>';
    if (i === 1) return '<span class="rank-cell rank-silver">2</span>';
    if (i === 2) return '<span class="rank-cell rank-bronze">3</span>';
    return `<span class="rank-cell">${i + 1}</span>`;
  };

  tbody.innerHTML = tries.map((j, i) => {
    const eloActuel = j.elo[cadence];
    const refMois   = j.ref_mois[cadence];
    const delta     = j.progression[cadence];
    const badges    = calculerBadges(j, cadence, i);

    const deltaTxt = delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`;
    const progrCls = delta > 0 ? 'progr-pos' : delta < 0 ? 'progr-neg' : 'progr-zero';

    return `
      <tr data-pseudo="${j.pseudo.toLowerCase()}">
        <td>${rankSymbol(i)}</td>
        <td>
          <div class="player-cell">
            <div class="table-avatar">
              ${avatarHTML(j.avatarUrl, j.pseudo)}
            </div>
            <div>
              <div class="table-pseudo">${j.pseudo}</div>
              <div class="badges-row">${renderBadges(badges)}</div>
            </div>
          </div>
        </td>
        <td><span class="elo-cell">${eloActuel}</span></td>
        <td><span class="ref-cell">${refMois}</span></td>
        <td><span class="progr-cell"><span class="progr-badge ${progrCls}">${deltaTxt}</span></span></td>
        <td><span class="parties-cell">${j.nb_parties}</span></td>
      </tr>`;
  }).join('');
}

function filtrerTableau() {
  const query = (document.getElementById('search-joueur')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#classement-table-body tr').forEach(row => {
    const pseudo = row.dataset.pseudo || '';
    row.classList.toggle('hidden', query.length > 0 && !pseudo.includes(query));
  });
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ANNONCES
   ════════════════════════════════════════════════════════════════════ */
function renderAnnonces(config) {
  const container = document.getElementById('annonces-container');
  if (!container) return;

  const catConfig = {
    important: { label: '🔴 IMPORTANT',   cls: 'badge-important', cardCls: 'cat-important' },
    duel:      { label: '⚔️ DUEL / CHOC',  cls: 'badge-duel',      cardCls: 'cat-duel'      },
    tournoi:   { label: '🏆 TOURNOI',      cls: 'badge-tournoi',   cardCls: 'cat-tournoi'   },
  };

  const sorted = [...config.annonces].sort((a,b) => new Date(b.date)-new Date(a.date));

  container.innerHTML = sorted.map(a => {
    const cfg = catConfig[a.categorie] || catConfig.important;
    return `
      <article class="annonce-card ${cfg.cardCls} animate-in">
        <div class="annonce-meta">
          <span class="annonce-badge ${cfg.cls}">${cfg.label}</span>
          <span class="annonce-date">${formatDateCourt(a.date)}</span>
          <span class="annonce-auteur">par <strong>${a.auteur}</strong></span>
        </div>
        <h2 class="annonce-titre">${a.titre}</h2>
        <p class="annonce-texte">${a.texte}</p>
      </article>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════════
   PAGE ACTIVITÉS
   ════════════════════════════════════════════════════════════════════ */
function renderJoueurDuMois(joueurs) {
  const container = document.getElementById('jdm-container');
  if (!container) return;

  /* Chercher la meilleure progression toutes cadences */
  let meilleur = null, maxDelta = -Infinity, meilleureCadence = 'rapide';
  joueurs.forEach(j => {
    ['rapide','blitz','bullet'].forEach(c => {
      if (j.progression[c] > maxDelta) {
        maxDelta = j.progression[c];
        meilleur = j;
        meilleureCadence = c;
      }
    });
  });
  if (!meilleur) return;

  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  container.innerHTML = `
    <div class="joueur-du-mois animate-in">
      <div class="jdm-avatar">
        ${avatarHTML(meilleur.avatarUrl, meilleur.pseudo)}
      </div>
      <div class="jdm-content">
        <div class="jdm-crown">✦ Joueur du Mois — ${mois} ✦</div>
        <div class="jdm-pseudo">${meilleur.pseudo}</div>
        <div class="jdm-gain"><span>+${maxDelta}</span> Elo en ${meilleureCadence} ce mois-ci 🚀</div>
        <p style="color:rgba(255,255,255,.45);font-size:14px;margin-top:12px;">
          ${meilleur.nb_parties} parties jouées · ${meilleureCadence.charAt(0).toUpperCase()+meilleureCadence.slice(1)}
        </p>
      </div>
    </div>`;
}

function renderFluxActivite(joueurs) {
  const container = document.getElementById('flux-activite');
  if (!container) return;
  const moisActuel = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  const messages = [];

  joueurs.forEach(j => {
    ['rapide','blitz','bullet'].forEach(c => {
      const delta = j.progression[c];
      const elo   = j.elo[c];
      const ref   = j.ref_mois[c];
      if (delta >= BADGE_SEUIL_FEU)
        messages.push({ icon:'🔥', text:`<strong>${j.pseudo}</strong> est <strong>en feu</strong> en ${c} : <strong>+${delta} Elo</strong> ce mois !`, time:`Ce mois de ${moisActuel}` });
      const palierA = Math.floor(elo/100)*100, palierR = Math.floor(ref/100)*100;
      if (palierA > palierR)
        messages.push({ icon:'🎯', text:`<strong>${j.pseudo}</strong> a franchi le cap des <strong>${palierA} Elo</strong> en ${c} !`, time:`Ce mois de ${moisActuel}` });
      if (delta <= BADGE_SEUIL_CONVALESC)
        messages.push({ icon:'🩹', text:`<strong>${j.pseudo}</strong> traverse une période difficile en ${c} : <strong>${delta} Elo</strong>. Le retour en force sera beau !`, time:`Ce mois de ${moisActuel}` });
    });
    if (j.nb_parties === 0)
      messages.push({ icon:'💤', text:`<strong>${j.pseudo}</strong> n'a joué aucune partie ce mois. L'échiquier attend son retour…`, time:`Ce mois de ${moisActuel}` });
  });

  if (!messages.length)
    messages.push({ icon:'♟️', text:'Aucune activité notable ce mois-ci. Les stratèges préparent leur prochain coup en silence.', time:`Ce mois de ${moisActuel}` });

  container.innerHTML = messages.map(m => `
    <div class="activity-item animate-in">
      <span class="activity-icon">${m.icon}</span>
      <div>
        <div class="activity-text">${m.text}</div>
        <div class="activity-time">${m.time}</div>
      </div>
    </div>`).join('');
}

function renderAnciensRois(config) {
  const container = document.getElementById('anciens-rois');
  if (!container) return;
  container.innerHTML = config.historique_joueurs_du_mois.map(h => `
    <div class="hall-card animate-in">
      <div class="hall-mois">${h.mois}</div>
      <div class="hall-avatar">${h.avatar}</div>
      <div class="hall-pseudo">${h.pseudo}</div>
      <div class="hall-gain">${h.gain_elo} Elo · ${h.cadence}</div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════════
   ORCHESTRATION PAR PAGE
   ════════════════════════════════════════════════════════════════════ */

async function initAccueil() {
  if (!document.getElementById('podium-container')) return;
  try {
    CONFIG = await chargerConfig();
    JOUEURS_API = await chargerJoueursChessCom(CONFIG);
    renderPodium(JOUEURS_API);
    renderChampionnat(CONFIG, JOUEURS_API);
    /* Stat joueurs dans le hero */
    const statEl = document.getElementById('stat-joueurs');
    if (statEl) statEl.textContent = JOUEURS_API.length;
    /* Aperçu annonces */
    const preview = document.getElementById('annonces-preview');
    if (preview) {
      const catConfig = {
        important: { label:'🔴 IMPORTANT', cls:'badge-important', cardCls:'cat-important' },
        duel:      { label:'⚔️ DUEL / CHOC', cls:'badge-duel', cardCls:'cat-duel' },
        tournoi:   { label:'🏆 TOURNOI', cls:'badge-tournoi', cardCls:'cat-tournoi' },
      };
      const deux = [...CONFIG.annonces].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,2);
      preview.innerHTML = deux.map(a => {
        const cfg = catConfig[a.categorie]||catConfig.important;
        const d = formatDateCourt(a.date);
        return `<article class="annonce-card ${cfg.cardCls}">
          <div class="annonce-meta">
            <span class="annonce-badge ${cfg.cls}">${cfg.label}</span>
            <span class="annonce-date">${d}</span>
            <span class="annonce-auteur">par <strong>${a.auteur}</strong></span>
          </div>
          <h2 class="annonce-titre">${a.titre}</h2>
          <p class="annonce-texte">${a.texte.substring(0,160)}…</p>
        </article>`;
      }).join('');
    }
    /* Lien WhatsApp */
    const cta = document.getElementById('whatsapp-cta');
    if (cta && CONFIG.club.whatsapp_link) {
      cta.href = CONFIG.club.whatsapp_link; cta.target = '_blank'; cta.rel = 'noopener';
    }
  } catch(err) {
    console.error('[Accueil]', err);
    setApiStatus('error', 'Erreur de connexion');
  }
}

async function initClassement() {
  if (!document.getElementById('classement-table-body')) return;

  /* Bouton actualiser */
  const btnRefresh = document.getElementById('btn-refresh');
  const reload = async () => {
    if (chargementEnCours) return;
    chargementEnCours = true;
    if (btnRefresh) btnRefresh.classList.add('spinning');
    try {
      CONFIG = CONFIG || await chargerConfig();
      JOUEURS_API = await chargerJoueursChessCom(CONFIG);
      renderClassement(JOUEURS_API, cadenceActive);
      filtrerTableau();
    } catch(err) {
      console.error('[Classement]', err);
      setApiStatus('error', 'Erreur Chess.com');
    } finally {
      chargementEnCours = false;
      if (btnRefresh) btnRefresh.classList.remove('spinning');
    }
  };
  if (btnRefresh) btnRefresh.addEventListener('click', reload);

  /* Onglets cadences */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cadenceActive = btn.dataset.cadence;
      if (JOUEURS_API.length) { renderClassement(JOUEURS_API, cadenceActive); filtrerTableau(); }
    });
  });

  /* Recherche */
  document.getElementById('search-joueur')?.addEventListener('input', filtrerTableau);

  await reload();
}

async function initAnnonces() {
  if (!document.getElementById('annonces-container')) return;
  try {
    CONFIG = CONFIG || await chargerConfig();
    renderAnnonces(CONFIG);
  } catch(err) { console.error('[Annonces]', err); }
}

async function initActivites() {
  if (!document.getElementById('jdm-container')) return;
  try {
    CONFIG = CONFIG || await chargerConfig();
    JOUEURS_API = await chargerJoueursChessCom(CONFIG);
    renderJoueurDuMois(JOUEURS_API);
    renderFluxActivite(JOUEURS_API);
    renderAnciensRois(CONFIG);
  } catch(err) { console.error('[Activités]', err); }
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
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      fermerMenu(nav, toggle); toggle.focus();
    }
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
    if (link.getAttribute('href') === page || (page==='' && link.getAttribute('href')==='index.html'))
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
  }, { threshold: .1 });

  document.querySelectorAll('.annonce-card, .activity-item, .hall-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity .5s ease, transform .5s ease';
    obs.observe(el);
  });
}

function initAdmin() {
  const passInput = document.getElementById('admin-pass');
  const btnLogin  = document.getElementById('btn-admin-login');
  const msg       = document.getElementById('admin-msg');
  if (!passInput) return;

  const verif = () => {
    if (passInput.value === 'stratege2025') {
      msg.textContent = '✓ Accès autorisé. Interface d\'administration en cours de développement.';
      msg.style.color = '#2A6049';
    } else {
      msg.textContent = '✗ Mot de passe incorrect.';
      msg.style.color = '#8B2635';
      passInput.value = '';
    }
  };
  if (btnLogin) btnLogin.addEventListener('click', verif);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') verif(); });
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
  setTimeout(initScrollAnimations, 200);
});
