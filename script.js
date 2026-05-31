/* ===================================================================
   LA TABLE DES STRATÈGES — script.js
   Logique principale : Chargement données, badges, classement, activités
   =================================================================== */

'use strict';

// ── Constantes ──────────────────────────────────────────────────────
const BADGE_SEUIL_FEU         = 50;   // +50 Elo ou plus → 🔥 En feu
const BADGE_SEUIL_CONVALESC   = -50;  // -50 Elo ou pire → 🩹 En convalescence
const BADGE_INACTIF_PARTIES   = 0;    // 0 parties ce mois → 💤 Inactif

// ── État global ──────────────────────────────────────────────────────
let DATA = null;
let cadenceActive = 'rapide';

// ── Chargement des données ───────────────────────────────────────────
async function chargerDonnees() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Impossible de charger data.json');
    DATA = await response.json();
    return DATA;
  } catch (err) {
    console.error('[Table des Stratèges] Erreur de chargement :', err);
    afficherErreurChargement();
    return null;
  }
}

function afficherErreurChargement() {
  const zones = document.querySelectorAll('.js-zone');
  zones.forEach(z => {
    z.innerHTML = `<p style="color:#8B2635;font-style:italic;padding:20px;">
      Impossible de charger les données. Vérifiez que data.json est accessible.
    </p>`;
  });
}

// ── Logique Badges ───────────────────────────────────────────────────
function calculerBadges(joueur, cadence, rankIndex, joueursTries) {
  const badges = [];
  const elo = joueur.elo[cadence];
  const delta = elo.actuel - elo.debut_mois;

  // 🔥 En feu
  if (delta >= BADGE_SEUIL_FEU) {
    badges.push({ emoji: '🔥', label: 'En feu', titre: `En feu ! +${delta} Elo ce mois` });
  }

  // 👑 Leader
  if (rankIndex === 0) {
    badges.push({ emoji: '👑', label: 'Leader', titre: 'Leader du classement' });
  }

  // 🎯 Palier — a-t-il franchi un cap de centaine ?
  const palierActuel  = Math.floor(elo.actuel / 100) * 100;
  const palierDebut   = Math.floor(elo.debut_mois / 100) * 100;
  const palierRef     = elo.reference_palier;
  if (palierActuel > palierDebut && elo.actuel >= palierRef && elo.debut_mois < palierRef) {
    badges.push({ emoji: '🎯', label: 'Palier', titre: `Palier franchi : ${palierRef} Elo !` });
  }

  // 🩹 En convalescence
  if (delta <= BADGE_SEUIL_CONVALESC) {
    badges.push({ emoji: '🩹', label: 'En convalescence', titre: `En convalescence… ${delta} Elo ce mois` });
  }

  // 💤 Inactif
  if (joueur.parties_ce_mois <= BADGE_INACTIF_PARTIES) {
    badges.push({ emoji: '💤', label: 'Inactif', titre: 'Aucune partie jouée ce mois' });
  }

  return badges;
}

function renderBadges(badges) {
  if (!badges.length) return '';
  return badges.map(b =>
    `<span class="badge" title="${b.titre}">${b.emoji}</span>`
  ).join('');
}

// ── Tri du classement ────────────────────────────────────────────────
function trierJoueurs(joueurs, cadence) {
  return [...joueurs].sort((a, b) =>
    b.elo[cadence].actuel - a.elo[cadence].actuel
  );
}

// ── Format date lisible ──────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateCourt(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ══════════════════════════════════════════════════════════════════════
//  PAGE : ACCUEIL (index.html)
// ══════════════════════════════════════════════════════════════════════
function initAccueil() {
  if (!document.getElementById('podium-container')) return;
  chargerDonnees().then(data => {
    if (!data) return;
    renderPodium(data);
    renderChampionnat(data);
  });
}

function renderPodium(data) {
  const container = document.getElementById('podium-container');
  if (!container) return;

  const cadences = [
    { key: 'rapide', label: 'Rapide', icon: '⏱️' },
    { key: 'blitz',  label: 'Blitz',  icon: '⚡' },
    { key: 'bullet', label: 'Bullet', icon: '🔫' },
  ];

  container.innerHTML = cadences.map(c => {
    const tries = trierJoueurs(data.joueurs, c.key);
    const top3  = tries.slice(0, 3);
    const rankClasses = ['rank-1', 'rank-2', 'rank-3'];
    const rankSymbols = ['1', '2', '3'];

    return `
      <div class="podium-card animate-in">
        <div class="podium-card-header">
          <span class="podium-cadence-name">${c.label}</span>
          <span class="podium-cadence-icon">${c.icon}</span>
        </div>
        <div class="podium-entries">
          ${top3.map((j, i) => `
            <div class="podium-entry ${rankClasses[i]}">
              <span class="podium-rank">${rankSymbols[i]}</span>
              <div class="podium-avatar">${j.avatar}</div>
              <div class="podium-info">
                <div class="podium-pseudo">${j.pseudo}</div>
                <div class="podium-elo">${j.elo[c.key].actuel} Elo</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderChampionnat(data) {
  const container = document.getElementById('championnat-container');
  if (!container) return;
  const champ = data.club.champion;

  container.innerHTML = `
    <div class="championship-block">
      <!-- Champion -->
      <div class="champ-slot">
        <span class="champ-label">👑 Tenant du Titre</span>
        <div class="champ-avatar-big champion-pulse">${champ.avatar}</div>
        <div>
          <div class="champ-pseudo">${champ.pseudo}</div>
          <div class="champ-elo">${champ.elo_rapid} Elo (Rapide)</div>
          <div class="champ-date">Champion depuis le ${formatDate(champ.crowned_date)}</div>
        </div>
      </div>
      <!-- Séparateur -->
      <div class="champ-separator">
        <div class="champ-vs-line"></div>
        <div class="champ-vs">VS</div>
        <div class="champ-vs-line"></div>
      </div>
      <!-- Challenger -->
      <div class="champ-slot challenger-slot">
        <span class="champ-label" style="color:rgba(255,255,255,0.3);border-color:rgba(255,255,255,0.1);">⚔️ Challenger</span>
        <div class="challenger-avatar">❓</div>
        <p class="challenger-text">
          À déterminer via le<br>
          <em>Tournoi des Candidats<br>en cours</em>
        </p>
        <span class="challenger-tag">⚔️ En cours de sélection</span>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════
//  PAGE : CLASSEMENT (classement.html)
// ══════════════════════════════════════════════════════════════════════
function initClassement() {
  if (!document.getElementById('classement-table-body')) return;
  chargerDonnees().then(data => {
    if (!data) return;

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cadenceActive = btn.dataset.cadence;
        renderClassement(data, cadenceActive);
        filtrerTableau();
      });
    });

    // Recherche
    const searchInput = document.getElementById('search-joueur');
    if (searchInput) {
      searchInput.addEventListener('input', filtrerTableau);
    }

    renderClassement(data, cadenceActive);
  });
}

function renderClassement(data, cadence) {
  const tbody = document.getElementById('classement-table-body');
  if (!tbody) return;
  const tries = trierJoueurs(data.joueurs, cadence);

  const rankClass = (i) => {
    if (i === 0) return 'rank-gold';
    if (i === 1) return 'rank-silver';
    if (i === 2) return 'rank-bronze';
    return '';
  };
  const rankSymbol = (i) => {
    if (i === 0) return '♚';
    if (i === 1) return '2';
    if (i === 2) return '3';
    return (i + 1).toString();
  };

  tbody.innerHTML = tries.map((j, i) => {
    const elo     = j.elo[cadence];
    const delta   = elo.actuel - elo.debut_mois;
    const badges  = calculerBadges(j, cadence, i, tries);
    const badgesHtml = renderBadges(badges);

    const deltaTxt = delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`;
    const deltaCls = delta > 0 ? 'evo-pos' : delta < 0 ? 'evo-neg' : 'evo-zero';
    const resultKey = j.derniere_partie[cadence] || 'null';
    const resultDot = `<span class="result-dot result-${resultKey}" title="${resultKey}"></span>`;

    return `
      <tr data-pseudo="${j.pseudo.toLowerCase()}">
        <td><span class="rank-cell ${rankClass(i)}">${rankSymbol(i)}</span></td>
        <td>
          <div class="player-cell">
            <div class="table-avatar">${j.avatar}</div>
            <div>
              <div class="table-pseudo">${j.pseudo}</div>
              <div class="badges-row">${badgesHtml}</div>
            </div>
          </div>
        </td>
        <td><span class="evo-cell ${deltaCls}">${deltaTxt}</span></td>
        <td><span class="elo-cell">${elo.actuel}</span></td>
        <td>${resultDot}</td>
      </tr>
    `;
  }).join('');
}

function filtrerTableau() {
  const query = (document.getElementById('search-joueur')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#classement-table-body tr').forEach(row => {
    const pseudo = row.dataset.pseudo || '';
    row.classList.toggle('hidden', query.length > 0 && !pseudo.includes(query));
  });
}

// ══════════════════════════════════════════════════════════════════════
//  PAGE : ANNONCES (annonces.html)
// ══════════════════════════════════════════════════════════════════════
function initAnnonces() {
  if (!document.getElementById('annonces-container')) return;
  chargerDonnees().then(data => {
    if (!data) return;
    renderAnnonces(data);
  });
}

function renderAnnonces(data) {
  const container = document.getElementById('annonces-container');
  if (!container) return;

  const catConfig = {
    important: { label: '🔴 IMPORTANT',  cls: 'badge-important', cardCls: 'cat-important' },
    duel:      { label: '⚔️ DUEL / CHOC', cls: 'badge-duel',      cardCls: 'cat-duel' },
    tournoi:   { label: '🏆 TOURNOI',     cls: 'badge-tournoi',   cardCls: 'cat-tournoi' },
  };

  const annonces = [...data.annonces].sort((a, b) => new Date(b.date) - new Date(a.date));

  container.innerHTML = annonces.map(a => {
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
      </article>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════
//  PAGE : ACTIVITÉS (activites.html)
// ══════════════════════════════════════════════════════════════════════
function initActivites() {
  if (!document.getElementById('jdm-container')) return;
  chargerDonnees().then(data => {
    if (!data) return;
    renderJoueurDuMois(data);
    renderFluxActivite(data);
    renderAnciensRois(data);
  });
}

function renderJoueurDuMois(data) {
  const container = document.getElementById('jdm-container');
  if (!container) return;

  // Calculer le joueur avec la plus forte progression toutes cadences confondues
  let meilleur = null;
  let meilleureProgression = -Infinity;
  let meilleuresCadence = 'rapide';

  data.joueurs.forEach(j => {
    ['rapide', 'blitz', 'bullet'].forEach(c => {
      const delta = j.elo[c].actuel - j.elo[c].debut_mois;
      if (delta > meilleureProgression) {
        meilleureProgression = delta;
        meilleur = j;
        meilleuresCadence = c;
      }
    });
  });

  if (!meilleur) return;

  const moisActuel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  container.innerHTML = `
    <div class="joueur-du-mois animate-in">
      <div class="jdm-avatar">${meilleur.avatar}</div>
      <div class="jdm-content">
        <div class="jdm-crown">✦ Joueur du Mois — ${moisActuel} ✦</div>
        <div class="jdm-pseudo">${meilleur.pseudo}</div>
        <div class="jdm-gain">
          <span>+${meilleureProgression}</span> Elo en ${meilleuresCadence} ce mois-ci 🚀
        </div>
        <p style="color:rgba(255,255,255,0.45);font-size:14px;margin-top:12px;">
          ${meilleur.parties_ce_mois} parties jouées · ${meilleuresCadence.charAt(0).toUpperCase() + meilleuresCadence.slice(1)}
        </p>
      </div>
    </div>
  `;
}

function renderFluxActivite(data) {
  const container = document.getElementById('flux-activite');
  if (!container) return;

  const messages = [];
  const moisActuel = new Date().toLocaleDateString('fr-FR', { month: 'long' });

  data.joueurs.forEach(j => {
    ['rapide', 'blitz', 'bullet'].forEach(c => {
      const elo = j.elo[c];
      const delta = elo.actuel - elo.debut_mois;
      const badges = calculerBadges(j, c, 0, []); // ranks approximatifs pour activité

      // 🔥 En feu
      if (delta >= BADGE_SEUIL_FEU) {
        messages.push({
          icon: '🔥',
          text: `<strong>${j.pseudo}</strong> est <strong>en feu</strong> en ${c} ce mois-ci avec une progression de <strong>+${delta} Elo</strong> !`,
          time: `Ce mois de ${moisActuel}`
        });
      }

      // 🎯 Palier
      const palierRef = elo.reference_palier;
      if (elo.actuel >= palierRef && elo.debut_mois < palierRef) {
        messages.push({
          icon: '🎯',
          text: `<strong>${j.pseudo}</strong> a franchi le cap symbolique des <strong>${palierRef} Elo</strong> en ${c}. Un cap important dans la progression !`,
          time: `Ce mois de ${moisActuel}`
        });
      }

      // 🩹 En convalescence
      if (delta <= BADGE_SEUIL_CONVALESC) {
        messages.push({
          icon: '🩹',
          text: `<strong>${j.pseudo}</strong> traverse une période difficile en ${c} avec <strong>${delta} Elo</strong> ce mois-ci. Le retour en force sera d'autant plus beau !`,
          time: `Ce mois de ${moisActuel}`
        });
      }
    });

    // 💤 Inactif
    if (j.parties_ce_mois <= BADGE_INACTIF_PARTIES) {
      messages.push({
        icon: '💤',
        text: `<strong>${j.pseudo}</strong> n'a joué aucune partie ce mois. L'échiquier attend son retour...`,
        time: `Ce mois de ${moisActuel}`
      });
    }
  });

  if (!messages.length) {
    messages.push({
      icon: '♟️',
      text: 'Aucune activité notable à signaler ce mois-ci. Les stratèges préparent leur prochain coup en silence.',
      time: `Ce mois de ${moisActuel}`
    });
  }

  container.innerHTML = messages.map(m => `
    <div class="activity-item animate-in">
      <span class="activity-icon">${m.icon}</span>
      <div>
        <div class="activity-text">${m.text}</div>
        <div class="activity-time">${m.time}</div>
      </div>
    </div>
  `).join('');
}

function renderAnciensRois(data) {
  const container = document.getElementById('anciens-rois');
  if (!container) return;

  container.innerHTML = data.historique_joueurs_du_mois.map(h => `
    <div class="hall-card animate-in">
      <div class="hall-mois">${h.mois}</div>
      <div class="hall-avatar">${h.avatar}</div>
      <div class="hall-pseudo">${h.pseudo}</div>
      <div class="hall-gain">${h.gain_elo} Elo · ${h.cadence}</div>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════════════════
//  NAVBAR mobile toggle
// ══════════════════════════════════════════════════════════════════════
function initNavbar() {
  const toggle = document.getElementById('navbar-toggle');
  const nav    = document.getElementById('navbar-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
  // Fermer en cliquant ailleurs
  document.addEventListener('click', e => {
    if (!toggle.contains(e.target) && !nav.contains(e.target)) {
      nav.classList.remove('open');
    }
  });
}

// ── Marquer le lien actif dans la navbar ────────────────────────────
function marquerLienActif() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.navbar-nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

// ── Animation d'entrée au scroll ────────────────────────────────────
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.podium-card, .annonce-card, .activity-item, .hall-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ── Page Admin (simple authentification fictive) ─────────────────────
function initAdmin() {
  const form = document.getElementById('admin-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = document.getElementById('admin-pass').value;
    const msg  = document.getElementById('admin-msg');
    if (pass === 'stratege2025') {
      msg.textContent = '✓ Accès autorisé. Interface d\'administration en cours de développement.';
      msg.style.color = '#2A6049';
    } else {
      msg.textContent = '✗ Mot de passe incorrect. Veuillez réessayer.';
      msg.style.color = '#8B2635';
    }
  });
}

// ── Point d'entrée ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  marquerLienActif();
  initAccueil();
  initClassement();
  initAnnonces();
  initActivites();
  initAdmin();

  // Déclencher les animations après le rendu
  setTimeout(initScrollAnimations, 100);
});
