import { LitElement, html, css } from 'https://unpkg.com/lit-element/lit-element.js?module';
import {
  loadSettingsFromAddonServer,
  saveSettingsToAddonServer,
  fetchAddonLogs,
} from './addon-persist.mjs';

// Vault-Tec Terminal Theme - verwendet system fonts (Courier New, Consolas)

/** Intervall, in dem relevante HA-States geprüft werden (In-Place-Updates von hass lösen bei Lit oft kein Re-Render aus). */
const HKWEB_STATE_POLL_MS = 200;

/** Add-on: optional `www/hkweb-autosave.json`. (Original: /config/www/hkweb/hkweb-autosave.json) */
const HKWEB_AUTOSAVE_RELATIVE = './hkweb-autosave.json';

/**
 * Entity-IDs: Baseline siehe `hk_addon/ENTITY_NOMENKLATUR.md` → Projektroot `HOME ASSISTANT ENTITÄTEN.md`.
 * Standard-IDs je Klappe: buildKlappeEntityDefaults(klappeId). Wichtig: Status = sensor.hkN_status_hkN (Ausnahme).
 */

/**
 * Nach „Zurück“ im Browser liefert der Back-Forward-Cache (bfcache) oft die alte
 * Seite ohne neu geladene JS-Module – die Versionsanzeige bleibt veraltet.
 * Bei Wiederanzeige aus dem bfcache: vollständig neu laden.
 */
if (typeof window !== 'undefined' && !window.__hkwebBfCacheBound) {
  window.__hkwebBfCacheBound = true;
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      window.location.reload();
    }
  });
}

// --- HK WEB App (Fallout Theme) ---
class HKWebApp extends LitElement {
  static VERSION = '2.1.17';

  /** Sidebar: im Add-on = Git/config (window.__HK_ADDON_VERSION__), sonst App-Bundle-Version. */
  static getDisplayVersion() {
    if (typeof window !== 'undefined' && window.__HK_ADDON_VERSION__) {
      return String(window.__HK_ADDON_VERSION__);
    }
    return HKWebApp.VERSION;
  }

  static get properties() {
    return {
      hass: {
        type: Object,
        hasChanged: (n, o) => n !== o,
      },
      activeTab: { type: String },
      theme: { type: String },
      cardAlpha: { type: Number },
      sidebarAlpha: { type: Number },
      logEntries: { type: Array },
      modi: { type: Array },
      plz: { type: String },
      sunriseTime: { type: String },
      sunsetTime: { type: String },
      sidebarCollapsed: { type: Boolean },
      showEntityCheckModal: { type: Boolean },
      entityCheckProgress: { type: Object },
      entityCheckResults: { type: Object },
      entityAutoRepairBusy: { type: Boolean },
      /** false bis hkweb-autosave.json (optional) geladen oder übersprungen wurde */
      settingsReady: { type: Boolean },
      /** Tab „Log“: app | addon */
      logPanelTab: { type: String },
      addonLogLines: { type: Array },
      /** Persistiert (hkweb_notes → /data über buildSettingsSnapshot) */
      userNotes: { type: String },
    };
  }

  constructor() {
    super();
    this.settingsReady = false;
    this.activeTab = 'klappen';
    this.theme = localStorage.getItem('liqglass_theme') || 'light';
    this.cardAlpha = Number(localStorage.getItem('liqglass_cardAlpha')) || 0.25;
    this.sidebarAlpha = Number(localStorage.getItem('liqglass_sidebarAlpha')) || 0.18;
    this.logEntries = [];
    this.lastEntityStates = {};
    this.statePollTimer = null;
    this._lastStatesSnapshot = '';
    /** Kurzzeit-Anzeige-Override nach Slider-Bedienung, bis HA den gleichen Wert meldet. */
    this._speedUiOverride = {};
    this.plz = localStorage.getItem('hkweb_plz') || '';
    this.sunriseTime = '';
    this.sunsetTime = '';
    this.klappenConfig = null;
    this.entityValidation = {};
    this.showEntityCheckModal = false;
    this.entityCheckProgress = { current: 0, total: 0, currentKlappe: '', currentEntity: '' };
    this.entityCheckResults = { klappen: [], errors: [], summary: {} };
    this.entityAutoRepairBusy = false;
    this.logPanelTab = 'app';
    this.addonLogLines = [];
    this.userNotes = localStorage.getItem('hkweb_notes') || '';
    this._persistTimer = null;
    this._suppressPersist = false;
    this._addonLogPollTimer = null;
    // Sidebar standardmäßig auf mobilen Geräten collapsed
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    this.sidebarCollapsed = localStorage.getItem('hkweb_sidebarCollapsed') !== null 
      ? localStorage.getItem('hkweb_sidebarCollapsed') === 'true'
      : isMobile;
    this.loadModi();
    // Lade Klappen-Konfiguration
    this.getKlappenConfig();
    // Wenn keine globale PLZ, aber eine Klappe im Tag/Nacht Modus hat PLZ, verwende diese
    if (!this.plz && this.klappenModi) {
      const klappen = this.getKlappenConfig();
      for (const k of klappen) {
        const modusData = this.klappenModi[k.id];
        if (modusData && modusData.modus === 'daynight' && modusData.daynight && modusData.daynight.plz) {
          this.plz = modusData.daynight.plz;
          localStorage.setItem('hkweb_plz', this.plz);
          break;
        }
      }
    }
    this.applyTheme();
    this.applyTransparency();
    if (this.plz && this.plz.length >= 5) {
      this.fetchSunriseSunset();
    }
  }

  _isAllowedAutosaveKey(key) {
    if (typeof key !== 'string' || key.length === 0) return false;
    return (
      key.startsWith('hkweb_') ||
      key.startsWith('liqglass_') ||
      key.startsWith('klappen_name_')
    );
  }

  buildSettingsSnapshot() {
    const keys = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !this._isAllowedAutosaveKey(key)) continue;
      keys[key] = localStorage.getItem(key);
    }
    return { v: 1, savedAt: new Date().toISOString(), keys };
  }

  _applySettingsSnapshotFromObject(data) {
    if (!data || typeof data !== 'object') return false;
    const blob = data.keys;
    if (!blob || typeof blob !== 'object') return false;
    let n = 0;
    for (const [k, v] of Object.entries(blob)) {
      if (typeof v !== 'string' || !this._isAllowedAutosaveKey(k)) continue;
      localStorage.setItem(k, v);
      n++;
    }
    return n > 0;
  }

  _rehydrateFromLocalStorage() {
    this.klappenConfig = null;
    this.theme = localStorage.getItem('liqglass_theme') || 'light';
    this.cardAlpha = Number(localStorage.getItem('liqglass_cardAlpha')) || 0.25;
    this.sidebarAlpha = Number(localStorage.getItem('liqglass_sidebarAlpha')) || 0.18;
    this.plz = localStorage.getItem('hkweb_plz') || '';
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    this.sidebarCollapsed =
      localStorage.getItem('hkweb_sidebarCollapsed') !== null
        ? localStorage.getItem('hkweb_sidebarCollapsed') === 'true'
        : isMobile;
    this.loadModi();
    this.getKlappenConfig();
    if (!this.plz && this.klappenModi) {
      const klappen = this.getKlappenConfig();
      for (const k of klappen) {
        const modusData = this.klappenModi[k.id];
        if (modusData && modusData.modus === 'daynight' && modusData.daynight && modusData.daynight.plz) {
          this.plz = modusData.daynight.plz;
          localStorage.setItem('hkweb_plz', this.plz);
          break;
        }
      }
    }
    this.applyTheme();
    this.applyTransparency();
    if (this.plz && this.plz.length >= 5) {
      this.fetchSunriseSunset();
    }
    this.entityValidation = this.hass?.states ? this.validateAllEntities() : {};
    this.userNotes = localStorage.getItem('hkweb_notes') || '';
  }

  async _loadAutosaveFromServerIfPresent() {
    try {
      const url = new URL(HKWEB_AUTOSAVE_RELATIVE, import.meta.url).href;
      const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return false;
      const data = await res.json();
      if (!this._applySettingsSnapshotFromObject(data)) return false;
      this._rehydrateFromLocalStorage();
      this.addLogEntry('Einstellungen aus hkweb-autosave.json (Server) geladen.');
      return true;
    } catch (e) {
      console.warn('[HK Web] hkweb-autosave.json:', e);
      return false;
    }
  }

  exportSettingsToFile() {
    const snap = this.buildSettingsSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hkweb-autosave.json';
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(a.href);
    this.addLogEntry('hkweb-autosave.json heruntergeladen — auf dem HA-Gerät nach /config/www/hkweb/ legen.');
  }

  _openAutosaveImportPicker() {
    const input = this.renderRoot?.querySelector('#hkweb-autosave-file');
    if (input) input.click();
  }

  importSettingsFromFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ''));
        if (!this._applySettingsSnapshotFromObject(data)) {
          this.addLogEntry('Import: ungültige Datei (keys fehlen oder leer).');
          return;
        }
        this._rehydrateFromLocalStorage();
        this.requestUpdate();
        this.addLogEntry('Einstellungen aus Datei importiert.');
        this._schedulePersistToData();
      } catch (err) {
        this.addLogEntry(`Import fehlgeschlagen: ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
  }

  connectedCallback() {
    super.connectedCallback();
    this._suppressPersist = true;
    this._initSettingsAndLoad()
      .finally(() => {
        this._suppressPersist = false;
        this.settingsReady = true;
        this.requestUpdate();
        if (typeof window !== 'undefined' && window.__HK_ADDON__) {
          this._schedulePersistToData();
        }
      });
    this._onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        this._lastStatesSnapshot = '';
        this._pollStateTick();
      }
    };
    window.addEventListener('visibilitychange', this._onVisibilityOrFocus);
    window.addEventListener('focus', this._onVisibilityOrFocus);
    this.startStatePoll();
    // Prüfe auf mobile Geräte und passe Sidebar an
    this.handleResize();
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }

  async _initSettingsAndLoad() {
    let loaded = false;
    if (typeof window !== 'undefined' && window.__HK_ADDON__) {
      try {
        const data = await loadSettingsFromAddonServer();
        if (data && this._applySettingsSnapshotFromObject(data)) {
          this._rehydrateFromLocalStorage();
          this.addLogEntry('Einstellungen aus Add-on-Speicher (/data) geladen.');
          loaded = true;
        }
      } catch (e) {
        console.warn('[HK Add-on] Laden /data:', e);
      }
    }
    if (!loaded) {
      await this._loadAutosaveFromServerIfPresent();
    }
  }

  /** Debounced Schreiben nach /data (Home-Assistant-Add-on) */
  _schedulePersistToData() {
    if (!this.settingsReady || this._suppressPersist) return;
    if (typeof window === 'undefined' || !window.__HK_ADDON__) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(async () => {
      try {
        const snap = this.buildSettingsSnapshot();
        await saveSettingsToAddonServer(snap);
      } catch (e) {
        console.warn('[HK Add-on] Speichern /data:', e);
      }
    }, 700);
  }

  async _refreshAddonLog() {
    if (typeof window === 'undefined' || !window.__HK_ADDON__) return;
    try {
      const lines = await fetchAddonLogs(900);
      this.addonLogLines = lines;
    } catch (e) {
      this.addonLogLines = [`[Fehler] ${e?.message || e}`];
    }
    this.requestUpdate();
  }

  _manageAddonLogPoll() {
    if (this._addonLogPollTimer) {
      clearInterval(this._addonLogPollTimer);
      this._addonLogPollTimer = null;
    }
    if (
      this.activeTab === 'log' &&
      this.logPanelTab === 'addon' &&
      typeof window !== 'undefined' &&
      window.__HK_ADDON__
    ) {
      this._refreshAddonLog();
      this._addonLogPollTimer = setInterval(() => this._refreshAddonLog(), 4000);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._addonLogPollTimer) {
      clearInterval(this._addonLogPollTimer);
      this._addonLogPollTimer = null;
    }
    this.stopStatePoll();
    if (this._onVisibilityOrFocus) {
      window.removeEventListener('visibilitychange', this._onVisibilityOrFocus);
      window.removeEventListener('focus', this._onVisibilityOrFocus);
    }
    window.removeEventListener('resize', this.handleResize);
  }
  
  handleResize() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile && !this.sidebarCollapsed) {
      // Auf mobilen Geräten standardmäßig collapsed
      this.sidebarCollapsed = true;
      this.requestUpdate();
    }
  }
  
  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem('hkweb_sidebarCollapsed', this.sidebarCollapsed.toString());
    this._schedulePersistToData();
    this.requestUpdate();
  }
  
  _entityKeysForSnapshot() {
    return [
      'statusEntity', 'zustandEntity', 'lastActionEntity',
      'endstopObenEntity', 'endstopUntenEntity',
      'buttonOeffnen', 'buttonSchliessen', 'buttonStop', 'buttonReset', 'buttonZentrale',
      'speedEntity', 'accelEntity', 'motorEnableEntity',
    ];
  }

  /** Snapshot aller konfigurierten Entitäten (State + Zeitstempel), damit In-Place-Änderungen an hass.states erkannt werden. */
  _computeStatesSnapshot() {
    if (!this.hass?.states) return '';
    const klappen = this.getKlappenConfig();
    const keys = this._entityKeysForSnapshot();
    const parts = [];
    for (const k of klappen) {
      for (const key of keys) {
        const id = k[key];
        if (!id) continue;
        const st = this.hass.states[id];
        if (st) {
          parts.push(`${id}:${st.state}:${st.last_updated || ''}:${st.last_changed || ''}`);
        } else {
          parts.push(`${id}:`);
        }
      }
    }
    return parts.join('|');
  }

  _pollStateTick() {
    if (!this.hass?.states) return;
    const snap = this._computeStatesSnapshot();
    if (snap === this._lastStatesSnapshot) return;
    this._lastStatesSnapshot = snap;
    this.entityValidation = this.validateAllEntities();
    this.checkEntityStates();
    this.requestUpdate();
  }

  startStatePoll() {
    if (this.statePollTimer) return;
    this._lastStatesSnapshot = '';
    this._pollStateTick();
    this.statePollTimer = setInterval(() => this._pollStateTick(), HKWEB_STATE_POLL_MS);
  }

  stopStatePoll() {
    if (this.statePollTimer) {
      clearInterval(this.statePollTimer);
      this.statePollTimer = null;
    }
  }

  addLogEntry(msg) {
    const now = new Date();
    const ts = now.toLocaleTimeString();
    this.logEntries = [
      { ts, msg },
      ...this.logEntries.slice(0, 99), // max 100 Einträge
    ];
  }

  updated(changedProps) {
    if (changedProps.has('theme')) {
      this.applyTheme();
      localStorage.setItem('liqglass_theme', this.theme);
      this.addLogEntry(`Theme geändert zu: ${this.theme}`);
      this.applyTransparency();
      this._schedulePersistToData();
    }
    if (changedProps.has('cardAlpha') || changedProps.has('sidebarAlpha')) {
      this.applyTransparency();
      localStorage.setItem('liqglass_cardAlpha', this.cardAlpha);
      localStorage.setItem('liqglass_sidebarAlpha', this.sidebarAlpha);
      if (changedProps.has('cardAlpha')) {
        this.addLogEntry(`Kachel-Transparenz geändert zu: ${Math.round(this.cardAlpha * 100)}%`);
      }
      if (changedProps.has('sidebarAlpha')) {
        this.addLogEntry(`Sidebar-Transparenz geändert zu: ${Math.round(this.sidebarAlpha * 100)}%`);
      }
      this._schedulePersistToData();
    }
    if (changedProps.has('activeTab') || changedProps.has('logPanelTab')) {
      this._manageAddonLogPoll();
    }
    if (changedProps.has('hass')) {
      // Sofortiger Check beim ersten Setzen
      this.checkEntityStates();
      // Validiere Entities
      this.entityValidation = this.validateAllEntities();
      this.requestUpdate();
    }
  }

  checkEntityStates() {
    if (!this.hass || !this.hass.states) return;
    const klappen = this.getKlappenConfig();
    klappen.forEach((k) => {
      if (k.statusEntity) {
        const state = this.hass.states[k.statusEntity]?.state;
        if (state !== undefined) {
          if (this.lastEntityStates[k.statusEntity] !== undefined && 
              this.lastEntityStates[k.statusEntity] !== state) {
            this.addLogEntry(`${k.name}: Status geändert zu "${state}"`);
          }
          this.lastEntityStates[k.statusEntity] = state;
        }
      }
    });
  }

  /**
   * Kanonische Default-Entity-IDs für eine Klappe `hkN` gemäß HOME ASSISTANT ENTITÄTEN.md.
   * Ausnahme Status: sensor.hkN_status_hkN (nicht hkN_hkN_status).
   */
  buildKlappeEntityDefaults(klappeId) {
    const d = klappeId;
    return {
      statusEntity: `sensor.${d}_status_${d}`,
      zustandEntity: `sensor.${d}_${d}_zustand`,
      lastActionEntity: `sensor.${d}_${d}_letzte_aktion`,
      endstopObenEntity: `sensor.${d}_${d}_endschalter_oben_status`,
      endstopUntenEntity: `sensor.${d}_${d}_endschalter_unten_status`,
      buttonOeffnen: `button.${d}_${d}_offnen`,
      buttonSchliessen: `button.${d}_${d}_schliessen`,
      buttonStop: `button.${d}_${d}_stop`,
      buttonReset: '',
      buttonZentrale: '',
      speedEntity: `number.${d}_${d}_geschwindigkeit`,
      accelEntity: '',
      motorEnableEntity: `switch.${d}_${d}_motor_enable`,
    };
  }

  getDefaultKlappenConfig() {
    return [
      {
        id: 'hk1',
        name: 'HK1 Gehege',
        ...this.buildKlappeEntityDefaults('hk1'),
      },
      {
        id: 'hk2',
        name: 'HK2 Garten',
        // Text-Sensoren für Status
        statusEntity: '',
        zustandEntity: '',
        lastActionEntity: '',
        endstopObenEntity: '',
        endstopUntenEntity: '',
        // Buttons
        buttonOeffnen: '',
        buttonSchliessen: '',
        buttonStop: '',
        buttonReset: '',
        buttonZentrale: 'button.hk_zentrale_hk2_garten',
        // Motor-Parameter
        speedEntity: '',
        accelEntity: '',
        // Motor Enable
        motorEnableEntity: '',
      },
      {
        id: 'hk3',
        name: 'HK3 Stall',
        // Text-Sensoren für Status
        statusEntity: '',
        zustandEntity: '',
        lastActionEntity: '',
        endstopObenEntity: '',
        endstopUntenEntity: '',
        // Buttons
        buttonOeffnen: '',
        buttonSchliessen: '',
        buttonStop: '',
        buttonReset: '',
        buttonZentrale: 'button.hk_zentrale_hk3_stall',
        // Motor-Parameter
        speedEntity: '',
        accelEntity: '',
        // Motor Enable
        motorEnableEntity: '',
      },
    ];
  }

  loadKlappenConfig() {
    const saved = localStorage.getItem('hkweb_klappen_config');
    const entityFields = [
      'statusEntity', 'zustandEntity', 'lastActionEntity',
      'endstopObenEntity', 'endstopUntenEntity',
      'buttonOeffnen', 'buttonSchliessen', 'buttonStop', 'buttonReset', 'buttonZentrale',
      'speedEntity', 'accelEntity', 'motorEnableEntity',
    ];
    if (saved) {
      try {
        const savedConfig = JSON.parse(saved);
        const defaultConfig = this.getDefaultKlappenConfig();
        // Merge: Verwende gespeicherte Werte, aber füge fehlende Klappen hinzu
        const merged = defaultConfig.map(defaultKlappe => {
          const savedKlappe = savedConfig.find(k => k.id === defaultKlappe.id);
          if (savedKlappe) {
            // Leere Strings aus localStorage dürfen Defaults (z. B. button.*) nicht überschreiben
            const merged = {
              ...defaultKlappe,
              ...savedKlappe,
              id: defaultKlappe.id,
              name: savedKlappe.name || defaultKlappe.name,
            };
            for (const f of entityFields) {
              const v = savedKlappe[f];
              merged[f] =
                v != null && String(v).trim() !== '' ? v : defaultKlappe[f];
            }
            return merged;
          }
          return defaultKlappe;
        });
        // Füge gespeicherte Klappen hinzu, die nicht in Default sind
        savedConfig.forEach(savedKlappe => {
          if (!merged.find(k => k.id === savedKlappe.id)) {
            merged.push(savedKlappe);
          }
        });
        return merged;
      } catch (e) {
        console.error('Fehler beim Laden der Klappen-Konfiguration:', e);
        return this.getDefaultKlappenConfig();
      }
    }
    return this.getDefaultKlappenConfig();
  }

  saveKlappenConfig(config) {
    // Speichere nur die konfigurierbaren Werte (nicht die Defaults)
    const toSave = config.map(k => ({
      id: k.id,
      name: k.name,
      statusEntity: k.statusEntity || '',
      zustandEntity: k.zustandEntity || '',
      lastActionEntity: k.lastActionEntity || '',
      endstopObenEntity: k.endstopObenEntity || '',
      endstopUntenEntity: k.endstopUntenEntity || '',
      buttonOeffnen: k.buttonOeffnen || '',
      buttonSchliessen: k.buttonSchliessen || '',
      buttonStop: k.buttonStop || '',
      buttonReset: k.buttonReset || '',
      buttonZentrale: k.buttonZentrale || '',
      speedEntity: k.speedEntity || '',
      accelEntity: k.accelEntity || '',
      motorEnableEntity: k.motorEnableEntity || '',
    }));
    localStorage.setItem('hkweb_klappen_config', JSON.stringify(toSave));
    // Speichere auch Klappennamen separat für Kompatibilität
    config.forEach(k => {
      localStorage.setItem('klappen_name_' + k.id, k.name);
    });
    this._schedulePersistToData();
  }

  getKlappenConfig() {
    if (!this.klappenConfig) {
      this.klappenConfig = this.loadKlappenConfig();
    }
    // Aktualisiere Namen aus LocalStorage (für Kompatibilität)
    this.klappenConfig = this.klappenConfig.map(k => ({
      ...k,
      name: localStorage.getItem('klappen_name_' + k.id) || k.name,
    }));
    return this.klappenConfig;
  }

  updateKlappenConfig(klappeId, field, value) {
    if (!this.klappenConfig) {
      this.klappenConfig = this.getKlappenConfig();
    }
    const klappe = this.klappenConfig.find(k => k.id === klappeId);
    if (klappe) {
      klappe[field] = value;
      this.saveKlappenConfig(this.klappenConfig);
      this.requestUpdate();
      this.addLogEntry(`Klappe ${klappeId}: ${field} geändert zu ${value}`);
    }
  }

  checkEntityExists(entityId) {
    if (!entityId || !this.hass || !this.hass.states) return false;
    return this.hass.states.hasOwnProperty(entityId);
  }

  /** Felder und Labels für Entity-Prüfung / Auto-Reparatur (eine Quelle). */
  getEntityCheckFieldDefinitions() {
    return [
      { key: 'statusEntity', label: 'Status', category: 'Text-Sensoren' },
      { key: 'zustandEntity', label: 'Zustand', category: 'Text-Sensoren' },
      { key: 'lastActionEntity', label: 'Letzte Aktion', category: 'Text-Sensoren' },
      { key: 'endstopObenEntity', label: 'Endschalter Oben', category: 'Text-Sensoren' },
      { key: 'endstopUntenEntity', label: 'Endschalter Unten', category: 'Text-Sensoren' },
      { key: 'buttonOeffnen', label: 'Öffnen', category: 'Buttons' },
      { key: 'buttonSchliessen', label: 'Schließen', category: 'Buttons' },
      { key: 'buttonStop', label: 'Stop', category: 'Buttons' },
      { key: 'buttonReset', label: 'Treiber Reset', category: 'Buttons' },
      { key: 'buttonZentrale', label: 'Zentrale', category: 'Buttons' },
      { key: 'speedEntity', label: 'Geschwindigkeit (%)', category: 'Motor-Parameter' },
      { key: 'accelEntity', label: 'Beschleunigung', category: 'Motor-Parameter' },
      { key: 'motorEnableEntity', label: 'Motor Enable', category: 'Motor-Parameter' },
    ];
  }

  _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Kandidaten-IDs für Auto-Reparatur (HOME ASSISTANT ENTITÄTEN.md):
   * Defaults, kanonische buildKlappeEntityDefaults, dann typische Tippfehler.
   * Wichtig: Status = sensor.hkN_status_hkN — keine Vertauschung zu hkN_hkN_status.
   */
  _buildEntityRepairCandidates(klappeId, fieldKey, configuredId) {
    const cands = [];
    const seen = new Set();
    const push = (id) => {
      if (!id || typeof id !== 'string') return;
      const t = id.trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      cands.push(t);
    };

    const defKlappe = this.getDefaultKlappenConfig().find((x) => x.id === klappeId);
    if (defKlappe?.[fieldKey]) push(defKlappe[fieldKey]);

    const canonical = this.buildKlappeEntityDefaults(klappeId);
    if (canonical[fieldKey]) push(canonical[fieldKey]);

    if (!configuredId || typeof configuredId !== 'string') return cands;

    const trimmed = configuredId.trim();
    const dot = trimmed.indexOf('.');
    if (dot < 0) return cands;
    const domain = trimmed.slice(0, dot);
    const rest = trimmed.slice(dot + 1);
    const kid = klappeId;
    const eKid = this._escapeRegExp(kid);

    if (fieldKey === 'statusEntity') {
      push(`sensor.${kid}_status_${kid}`);
      push(`sensor.${kid}_${kid}_status`);
      return cands;
    }

    const reSwap = new RegExp(`^${eKid}_([a-z0-9_]+)_${eKid}$`);
    const mSwap = rest.match(reSwap);
    if (mSwap) {
      push(`${domain}.${kid}_${kid}_${mSwap[1]}`);
    }

    if (fieldKey === 'lastActionEntity' && rest === `${kid}_letzte_aktion`) {
      push(`${domain}.${kid}_${kid}_letzte_aktion`);
    }

    const es = rest.match(new RegExp(`^${eKid}_endschalter_${eKid}_(oben|unten)$`));
    if (es) {
      push(`${domain}.${kid}_${kid}_endschalter_${es[1]}_status`);
      push(`${domain}.${kid}_${kid}_endschalter_${es[1]}`);
    }

    if (fieldKey === 'endstopObenEntity' || fieldKey === 'endstopUntenEntity') {
      const pos = fieldKey === 'endstopObenEntity' ? 'oben' : 'unten';
      if (rest === `${kid}_${kid}_endschalter_${pos}`) {
        push(`sensor.${kid}_${kid}_endschalter_${pos}_status`);
      }
      push(`binary_sensor.${kid}_${kid}_endschalter_${pos}`);
    }

    if (rest === `${kid}_zustand_${kid}`) {
      push(`${domain}.${kid}_${kid}_zustand`);
    }

    if (fieldKey === 'buttonReset') {
      push(`button.${kid}_${kid}_reset`);
      push(`button.${kid}_${kid}_reset_pulse`);
      push(`button.${kid}_${kid}_treiber_reset`);
      push(`button.${kid}_${kid}_treiber_reset_pulse`);
      push(`button.${kid}_treiber_reset_pulse`);
    }

    return cands;
  }

  _pickFirstExistingEntityId(candidates) {
    if (!this.hass?.states || !candidates?.length) return null;
    for (const id of candidates) {
      if (this.hass.states.hasOwnProperty(id)) return id;
    }
    return null;
  }

  /** Gleiche Ergebnisstruktur wie die async Prüfung, ohne Verzögerung (nach Auto-Reparatur). */
  buildEntityCheckResultsSync() {
    const klappen = this.getKlappenConfig();
    const entityFields = this.getEntityCheckFieldDefinitions();
    const results = { klappen: [], errors: [], summary: { total: 0, valid: 0, invalid: 0, notConfigured: 0 } };

    for (const k of klappen) {
      const klappeResult = {
        id: k.id,
        name: k.name,
        categories: {},
        errors: [],
      };

      entityFields.forEach((field) => {
        if (!klappeResult.categories[field.category]) {
          klappeResult.categories[field.category] = [];
        }
      });

      for (const field of entityFields) {
        const entityId = k[field.key];
        if (!entityId) continue;

        try {
          const exists = this.checkEntityExists(entityId);
          results.summary.total++;
          const entityResult = {
            field: field.key,
            label: field.label,
            entityId,
            exists,
            category: field.category,
          };
          if (!klappeResult.categories[field.category]) {
            klappeResult.categories[field.category] = [];
          }
          klappeResult.categories[field.category].push(entityResult);

          if (exists) {
            results.summary.valid++;
          } else {
            results.summary.invalid++;
            results.errors.push({
              klappe: k.name,
              field: field.label,
              entityId,
            });
            klappeResult.errors.push({
              field: field.label,
              entityId,
            });
          }
        } catch (error) {
          console.error(`Fehler beim Prüfen von ${entityId}:`, error);
          results.summary.invalid++;
          results.errors.push({
            klappe: k.name,
            field: field.label,
            entityId,
          });
          klappeResult.errors.push({
            field: field.label,
            entityId,
          });
        }
      }

      results.klappen.push(klappeResult);
    }

    return results;
  }

  performAutoRepairFromEntityCheck() {
    if (!this.hass?.states) {
      this.addLogEntry('Auto-Reparatur: keine Verbindung zu Home Assistant');
      return;
    }
    if (this.entityAutoRepairBusy) return;

    this.entityAutoRepairBusy = true;
    this.requestUpdate();

    const klappen = this.getKlappenConfig();
    const entityFields = this.getEntityCheckFieldDefinitions();
    const repairs = [];

    for (const k of klappen) {
      for (const field of entityFields) {
        const raw = k[field.key];
        if (!raw || !String(raw).trim()) continue;
        const entityId = String(raw).trim();
        if (this.checkEntityExists(entityId)) continue;

        const candidates = this._buildEntityRepairCandidates(k.id, field.key, entityId);
        const resolved = this._pickFirstExistingEntityId(candidates);
        if (resolved && resolved !== entityId) {
          repairs.push({
            klappeId: k.id,
            field: field.key,
            from: entityId,
            to: resolved,
          });
        }
      }
    }

    if (repairs.length === 0) {
      this.addLogEntry('Auto-Reparatur: keine bekannten Alternativen in HA gefunden (IDs manuell prüfen).');
      this.entityAutoRepairBusy = false;
      this.requestUpdate();
      return;
    }

    if (!this.klappenConfig) {
      this.klappenConfig = this.getKlappenConfig();
    }
    for (const r of repairs) {
      const klappe = this.klappenConfig.find((x) => x.id === r.klappeId);
      if (klappe) klappe[r.field] = r.to;
    }
    this.saveKlappenConfig(this.klappenConfig);

    this.entityValidation = this.validateAllEntities();
    this.entityCheckResults = this.buildEntityCheckResultsSync();
    this.addLogEntry(
      `Auto-Reparatur: ${repairs.length} Entity-ID(s) angepasst — ${repairs.map((r) => `${r.from} → ${r.to}`).join('; ')}`,
    );

    this.entityAutoRepairBusy = false;
    this.requestUpdate();
  }

  validateAllEntities() {
    if (!this.hass || !this.hass.states) return {};
    const klappen = this.getKlappenConfig();
    const validation = {};
    
    klappen.forEach(k => {
      validation[k.id] = {
        statusEntity: k.statusEntity ? this.checkEntityExists(k.statusEntity) : null,
        zustandEntity: k.zustandEntity ? this.checkEntityExists(k.zustandEntity) : null,
        lastActionEntity: k.lastActionEntity ? this.checkEntityExists(k.lastActionEntity) : null,
        endstopObenEntity: k.endstopObenEntity ? this.checkEntityExists(k.endstopObenEntity) : null,
        endstopUntenEntity: k.endstopUntenEntity ? this.checkEntityExists(k.endstopUntenEntity) : null,
        buttonOeffnen: k.buttonOeffnen ? this.checkEntityExists(k.buttonOeffnen) : null,
        buttonSchliessen: k.buttonSchliessen ? this.checkEntityExists(k.buttonSchliessen) : null,
        buttonStop: k.buttonStop ? this.checkEntityExists(k.buttonStop) : null,
        buttonReset: k.buttonReset ? this.checkEntityExists(k.buttonReset) : null,
        buttonZentrale: k.buttonZentrale ? this.checkEntityExists(k.buttonZentrale) : null,
        speedEntity: k.speedEntity ? this.checkEntityExists(k.speedEntity) : null,
        accelEntity: k.accelEntity ? this.checkEntityExists(k.accelEntity) : null,
        motorEnableEntity: k.motorEnableEntity ? this.checkEntityExists(k.motorEnableEntity) : null,
      };
    });
    
    return validation;
  }

  async performEntityCheckWithProgress() {
    if (!this.hass || !this.hass.states) {
      this.addLogEntry('Fehler: Keine Verbindung zu Home Assistant');
      return;
    }

    // Öffne Modal
    this.showEntityCheckModal = true;
    this.entityCheckProgress = { current: 0, total: 0, currentKlappe: '', currentEntity: '' };
    this.entityCheckResults = { klappen: [], errors: [], summary: { total: 0, valid: 0, invalid: 0, notConfigured: 0 } };
    this.requestUpdate();

    const klappen = this.getKlappenConfig();
    const entityFields = this.getEntityCheckFieldDefinitions();

    // Berechne Gesamtzahl
    let totalEntities = 0;
    klappen.forEach(k => {
      entityFields.forEach(field => {
        if (k[field.key]) totalEntities++;
      });
    });
    this.entityCheckProgress.total = totalEntities;

    const results = { klappen: [], errors: [], summary: { total: 0, valid: 0, invalid: 0, notConfigured: 0 } };

    // Prüfe jede Klappe
    let globalEntityIndex = 0;
    for (const k of klappen) {
      const klappeResult = {
        id: k.id,
        name: k.name,
        categories: {},
        errors: []
      };

      // Gruppiere nach Kategorien
      entityFields.forEach(field => {
        if (!klappeResult.categories[field.category]) {
          klappeResult.categories[field.category] = [];
        }
      });

      for (const field of entityFields) {
        const entityId = k[field.key];
        
        // Nur prüfen, wenn Entity konfiguriert ist
        if (entityId) {
          globalEntityIndex++;
          this.entityCheckProgress.current = globalEntityIndex;
          this.entityCheckProgress.currentKlappe = k.name;
          this.entityCheckProgress.currentEntity = field.label;
          this.requestUpdate();

          // Warte kurz für visuelles Feedback
          await new Promise(resolve => setTimeout(resolve, 50));

          try {
            const exists = this.checkEntityExists(entityId);
            results.summary.total++;
            
            const entityResult = {
              field: field.key,
              label: field.label,
              entityId: entityId,
              exists: exists,
              category: field.category
            };

            if (!klappeResult.categories[field.category]) {
              klappeResult.categories[field.category] = [];
            }
            klappeResult.categories[field.category].push(entityResult);

            if (exists) {
              results.summary.valid++;
            } else {
              results.summary.invalid++;
              results.errors.push({
                klappe: k.name,
                field: field.label,
                entityId: entityId
              });
              klappeResult.errors.push({
                field: field.label,
                entityId: entityId
              });
            }
          } catch (error) {
            console.error(`Fehler beim Prüfen von ${entityId}:`, error);
            results.summary.invalid++;
            results.errors.push({
              klappe: k.name,
              field: field.label,
              entityId: entityId
            });
            klappeResult.errors.push({
              field: field.label,
              entityId: entityId
            });
          }
        } else {
          // Nicht konfigurierte Entities werden nicht gezählt, aber in Summary erfasst
          // (nur wenn explizit geprüft werden soll)
        }
      }

      results.klappen.push(klappeResult);
    }

    this.entityCheckResults = results;
    this.entityValidation = this.validateAllEntities();
    this.requestUpdate();
    this.addLogEntry(`Entity-Prüfung abgeschlossen: ${results.summary.valid} OK, ${results.summary.invalid} Fehler, ${results.summary.notConfigured} nicht konfiguriert`);
  }

  loadModi() {
    const saved = localStorage.getItem('hkweb_klappen_modi');
    if (saved) {
      try {
        this.klappenModi = JSON.parse(saved);
        // Stelle sicher, dass alle aktuellen Klappen vorhanden sind
        const klappen = this.getKlappenConfig();
        klappen.forEach(k => {
          if (!this.klappenModi[k.id]) {
            this.klappenModi[k.id] = this.createDefaultModusConfig();
          }
        });
        this.saveModi();
      } catch (e) {
        console.error('Fehler beim Laden der Modi:', e);
        this.initializeModi();
      }
    } else {
      this.initializeModi();
    }
  }

  initializeModi() {
    // Pro Klappe einen Modus speichern
    this.klappenModi = {};
    const klappen = this.getKlappenConfig();
    klappen.forEach(k => {
      this.klappenModi[k.id] = this.createDefaultModusConfig();
    });
    this.saveModi();
  }

  createDefaultModusConfig() {
    return {
      modus: 'manual', // Standard: Manuell
      schedule: {
        oeffnenZeiten: [],
        schliessenZeiten: []
      },
      daynight: {
        plz: this.plz || '',
        offsetOeffnen: 0, // Minuten vor/nach Sonnenaufgang
        offsetSchliessen: 0 // Minuten vor/nach Sonnenuntergang
      },
      manual: {
        sicherheitsschliessen: false
      }
    };
  }

  saveModi() {
    localStorage.setItem('hkweb_klappen_modi', JSON.stringify(this.klappenModi));
    this._schedulePersistToData();
  }

  getKlappenModus(klappeId) {
    if (!this.klappenModi) this.loadModi();
    return this.klappenModi[klappeId] || this.createDefaultModusConfig();
  }

  setKlappenModus(klappeId, modus) {
    if (!this.klappenModi) this.loadModi();
    if (!this.klappenModi[klappeId]) {
      this.klappenModi[klappeId] = this.createDefaultModusConfig();
    }
    this.klappenModi[klappeId].modus = modus;
    // Wenn Tag/Nacht Modus und noch keine PLZ, verwende globale PLZ
    if (modus === 'daynight' && !this.klappenModi[klappeId].daynight.plz && this.plz) {
      this.klappenModi[klappeId].daynight.plz = this.plz;
    }
    this.saveModi();
    this.requestUpdate();
    const modusName = modus === 'schedule' ? 'Zeitpläne' : modus === 'daynight' ? 'Tag/Nacht' : 'Manuell';
    this.addLogEntry(`Klappe ${klappeId}: Modus geändert zu ${modusName}`);
  }

  updateKlappenModusEinstellung(klappeId, modusType, key, value) {
    if (!this.klappenModi) this.loadModi();
    if (!this.klappenModi[klappeId]) {
      this.klappenModi[klappeId] = this.createDefaultModusConfig();
    }
    if (!this.klappenModi[klappeId][modusType]) {
      this.klappenModi[klappeId][modusType] = modusType === 'schedule' 
        ? { oeffnenZeiten: [], schliessenZeiten: [] }
        : modusType === 'daynight'
        ? { plz: this.plz || '', offsetOeffnen: 0, offsetSchliessen: 0 }
        : { sicherheitsschliessen: false };
    }
    if (typeof key === 'object') {
      // Mehrere Werte auf einmal setzen
      Object.assign(this.klappenModi[klappeId][modusType], key);
    } else {
      this.klappenModi[klappeId][modusType][key] = value;
    }
    this.saveModi();
    this.requestUpdate();
  }

  async fetchSunriseSunset() {
    if (!this.plz || this.plz.length < 5) {
      this.sunriseTime = '';
      this.sunsetTime = '';
      return;
    }
    
    try {
      // Schritt 1: PLZ zu Koordinaten konvertieren (kostenlose API)
      // Verwende OpenStreetMap Nominatim API (kostenlos, keine API-Key nötig)
      const geocodeUrl = `https://nominatim.openstreetmap.org/search?postalcode=${this.plz}&countrycodes=de&format=json&limit=1`;
      
      const geoResponse = await fetch(geocodeUrl, {
        headers: {
          'User-Agent': 'HK-Web-App/1.0'
        }
      });
      
      if (!geoResponse.ok) throw new Error('Geocoding fehlgeschlagen');
      
      const geoData = await geoResponse.json();
      
      if (!geoData || geoData.length === 0) {
        throw new Error('PLZ nicht gefunden');
      }
      
      const lat = parseFloat(geoData[0].lat);
      const lon = parseFloat(geoData[0].lon);
      
      // Schritt 2: Sonnenauf-/untergang abrufen
      const sunResponse = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`);
      const sunData = await sunResponse.json();
      
      if (sunData.status === 'OK') {
        // Die API gibt UTC-Zeiten zurück (ISO 8601 Format)
        // Parse als UTC und konvertiere zu lokaler Zeit (Europe/Berlin)
        const sunriseUTC = new Date(sunData.results.sunrise + 'Z'); // Z = UTC
        const sunsetUTC = new Date(sunData.results.sunset + 'Z');
        
        // Konvertiere zu lokaler Zeit (Deutschland)
        // Verwende Intl.DateTimeFormat für korrekte Zeitzonen-Konvertierung
        const formatter = new Intl.DateTimeFormat('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Berlin'
        });
        
        this.sunriseTime = formatter.format(sunriseUTC);
        this.sunsetTime = formatter.format(sunsetUTC);
        this.requestUpdate();
        this.addLogEntry(`PLZ ${this.plz}: Sonnenaufgang ${this.sunriseTime}, Sonnenuntergang ${this.sunsetTime}`);
      } else {
        throw new Error('Sonnenzeiten-API Fehler');
      }
    } catch (error) {
      console.error('Fehler beim Abrufen der Sonnenzeiten:', error);
      // Fallback: Verwende Standard-Zeiten basierend auf Jahreszeit
      const now = new Date();
      const month = now.getMonth(); // 0-11
      // Sommer: Juni-August (5-7) - früher Sonnenaufgang
      if (month >= 5 && month <= 7) {
        this.sunriseTime = '05:30';
        this.sunsetTime = '21:00';
      } else if (month >= 2 && month <= 4) {
        // Frühling: März-Mai (2-4)
        this.sunriseTime = '06:00';
        this.sunsetTime = '20:00';
      } else if (month >= 8 && month <= 10) {
        // Herbst: September-November (8-10)
        this.sunriseTime = '07:00';
        this.sunsetTime = '18:00';
      } else {
        // Winter: Dezember-Februar (11, 0, 1)
        this.sunriseTime = '08:00';
        this.sunsetTime = '16:30';
      }
      this.requestUpdate();
      this.addLogEntry(`Fehler beim Abrufen der Sonnenzeiten für PLZ ${this.plz}, verwende Standard-Zeiten (${this.sunriseTime}/${this.sunsetTime})`);
    }
  }

  updatePLZ(klappeId, newPLZ) {
    this.updateKlappenModusEinstellung(klappeId, 'daynight', 'plz', newPLZ);
    if (newPLZ && newPLZ.length >= 5) {
      this.plz = newPLZ;
      localStorage.setItem('hkweb_plz', newPLZ);
      // Aktualisiere PLZ für alle anderen Klappen im Tag/Nacht-Modus
      if (this.klappenModi) {
        Object.keys(this.klappenModi).forEach(kId => {
          if (kId !== klappeId && this.klappenModi[kId].modus === 'daynight') {
            if (!this.klappenModi[kId].daynight.plz || this.klappenModi[kId].daynight.plz.length < 5) {
              this.klappenModi[kId].daynight.plz = newPLZ;
            }
          }
        });
        this.saveModi();
      }
      this.fetchSunriseSunset();
    }
  }

  applyTheme() {
    const root = document.documentElement;
    if (this.theme === 'dark') {
      root.style.setProperty('--liq-bg', 'linear-gradient(135deg, #23272f 0%, #2d3440 100%)');
      root.style.setProperty('--liq-text', '#f3f6fa');
      root.style.setProperty('--liq-shadow', 'rgba(0,0,0,0.35)');
    } else {
      root.style.setProperty('--liq-bg', 'linear-gradient(135deg, #e3e9f3 0%, #cfd8e6 100%)');
      root.style.setProperty('--liq-text', '#2a2e3a');
      root.style.setProperty('--liq-shadow', 'rgba(31, 38, 135, 0.18)');
    }
  }

  applyTransparency() {
    const cardAlpha = this.cardAlpha;
    const sidebarAlpha = this.sidebarAlpha;
    const cardColor = this.theme === 'dark'
      ? `rgba(40,44,52,${cardAlpha})`
      : `rgba(255,255,255,${cardAlpha})`;
    const sidebarColor = this.theme === 'dark'
      ? `rgba(30,32,38,${sidebarAlpha})`
      : `rgba(255,255,255,${sidebarAlpha})`;
    document.documentElement.style.setProperty('--liq-card', cardColor);
    document.documentElement.style.setProperty('--liq-sidebar', sidebarColor);
  }

  setTab(tab) {
    this.activeTab = tab;
  }

  _callButtonService(entityId) {
    if (!entityId || !this.hass?.callService) {
      this.addLogEntry(`Fehler: Button-Entity fehlt oder keine HA-Verbindung`);
      return;
    }
    if (!this.hass.states?.[entityId]) {
      this.addLogEntry(`Hinweis: ${entityId} nicht in hass.states – Aufruf wird trotzdem gesendet`);
    }

    console.log(`[Button] Rufe Service auf: button.press für ${entityId}`);
    // Neuere HA-Frontends: data und target getrennt (sonst wird button.press im Panel ignoriert)
    let promise = this.hass.callService('button', 'press', {}, { entity_id: entityId });
    if (!promise || typeof promise.then !== 'function') {
      const legacy = this.hass.callService('button', 'press', { entity_id: entityId });
      promise =
        legacy && typeof legacy.then === 'function' ? legacy : Promise.resolve(legacy);
    }
    promise
      .then(() => {
        this.addLogEntry(`✓ Button gedrückt: ${entityId}`);
        console.log(`[Button] Erfolg: ${entityId}`);
      })
      .catch((err) => {
        const msg = err?.message || err?.body?.message || String(err);
        this.addLogEntry(`✗ Fehler bei Button: ${entityId} – ${msg}`);
        console.error(`[Button] Fehler bei ${entityId}:`, err);
      });
  }

  _setNumberValue(entityId, value) {
    if (!entityId || !this.hass) {
      this.addLogEntry(`Fehler: Number-Entity fehlt oder keine HA-Verbindung`);
      return;
    }
    
    if (!this.hass.states?.[entityId]) {
      this.addLogEntry(`Fehler: Number-Entity nicht gefunden: ${entityId}`);
      return;
    }

    const numValue = Number(value);
    if (isNaN(numValue)) {
      this.addLogEntry(`Fehler: Ungültiger Wert für Number: ${value}`);
      return;
    }

    const entity = this.hass.states[entityId];
    const min = entity.attributes?.min ?? 0;
    const max = entity.attributes?.max ?? 100;
    const clampedValue = Math.max(min, Math.min(max, numValue));

    console.log(`[Number] Setze Wert: ${entityId} = ${clampedValue} (min: ${min}, max: ${max})`);
    this.hass.callService('number', 'set_value', { value: clampedValue }, { entity_id: entityId }).then(() => {
      this.addLogEntry(`✓ Number gesetzt: ${entityId} = ${clampedValue}`);
      console.log(`[Number] Erfolg: ${entityId} = ${clampedValue}`);
      // Aktualisiere UI
      this.requestUpdate();
    }).catch((err) => {
      this.addLogEntry(`✗ Fehler bei Number: ${entityId} - ${err.message}`);
      console.error(`[Number] Fehler bei ${entityId}:`, err);
    });
  }

  _toggleSwitch(entityId, state) {
    if (!entityId || !this.hass) return;
    const service = state ? 'turn_on' : 'turn_off';
    this.hass.callService('switch', service, {}, { entity_id: entityId }).then(() => {
      this.addLogEntry(`Switch ${service}: ${entityId}`);
    }).catch((err) => {
      this.addLogEntry(`Fehler bei Switch: ${entityId} - ${err.message}`);
    });
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setCardAlpha(e) {
    this.cardAlpha = Number(e.target.value);
  }

  setSidebarAlpha(e) {
    this.sidebarAlpha = Number(e.target.value);
  }

  setSpeedPercent(k, e) {
    if (!k.speedEntity || !this.hass) return;
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;

    const ent = this.hass.states[k.speedEntity];
    const min = ent?.attributes?.min ?? 0;
    let max = ent?.attributes?.max ?? 400;
    const step = ent?.attributes?.step ?? 1;
    let effectiveMin = min;

    if (k.id === 'hk1' && max <= 400.0001) {
      const oldMax = max;
      effectiveMin = oldMax;
      max = oldMax + 200;
    }

    const clamped = Math.max(effectiveMin, Math.min(max, raw));

    this._speedUiOverride[k.id] = { value: clamped, until: Date.now() + 4000 };
    localStorage.setItem(`hkweb_speed_${k.id}`, String(clamped));
    this._setNumberValue(k.speedEntity, clamped);
    this._schedulePersistToData();
    this.requestUpdate();
  }

  setAccelPercent(k, e) {
    const value = Number(e.target.value);
    // Speichere Wert in localStorage
    localStorage.setItem(`hkweb_accel_${k.id}`, value.toString());
    this._setNumberValue(k.accelEntity, value);
    this._schedulePersistToData();
    this.requestUpdate();
  }

  handleKlappenNameChange(id, e) {
    localStorage.setItem('klappen_name_' + id, e.target.value);
    this._schedulePersistToData();
    this.requestUpdate();
  }

  getStatusFromTextSensor(entityId) {
    if (!this.hass || !entityId) return null;
    return this.hass.states[entityId]?.state || null;
  }

  /** Zeitpunkt der letzten Zustandsänderung der Entity (wie in HA), für Anzeige bei „Letzte Aktion“. */
  formatHaTimestamp(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
    } catch (e) {
      return null;
    }
  }

  getEntityLastChangedFormatted(entityId) {
    if (!this.hass || !entityId) return null;
    const st = this.hass.states[entityId];
    if (!st) return null;
    const t = st.last_changed || st.last_updated;
    return this.formatHaTimestamp(t);
  }

  /** Aktuellen numerischen Zustand einer Number-Entity aus hass lesen (unavailable/unknown → null). */
  parseNumericStateFromHass(entityId) {
    if (!this.hass?.states || !entityId) return null;
    const raw = this.hass.states[entityId]?.state;
    if (raw === undefined || raw === null || raw === 'unavailable' || raw === 'unknown' || raw === '') {
      return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** Anzeige für Endschalter-/Motor-Zeilen: binary_sensor/switch on/off → Aktiv/Inaktiv, sonst Roh-State. */
  formatHardwareEntityState(entityId) {
    if (!entityId || !this.hass?.states?.[entityId]) return '—';
    const st = this.hass.states[entityId];
    const raw = st.state;
    if (raw === undefined || raw === null || raw === 'unavailable' || raw === 'unknown' || raw === '') return '—';
    const domain = entityId.split('.')[0];
    if (domain === 'binary_sensor' || domain === 'switch') {
      if (raw === 'on') return 'Aktiv';
      if (raw === 'off') return 'Inaktiv';
    }
    return String(raw);
  }

  getStatusClass(status) {
    if (!status) return '';
    const statusLower = status.toLowerCase();
    if (statusLower.includes('offen') || statusLower === 'offen') return 'offen';
    if (statusLower.includes('geschlossen') || statusLower === 'geschlossen') return 'geschlossen';
    if (statusLower.includes('bewegung') || statusLower.includes('fahrt')) return 'in-bewegung';
    if (statusLower.includes('störung') || statusLower.includes('storung')) return 'stoerung';
    return '';
  }

  updateUserNotes(value) {
    const v = value != null ? String(value) : '';
    this.userNotes = v;
    localStorage.setItem('hkweb_notes', v);
    this._schedulePersistToData();
  }

  renderSidebar() {
    const tabs = [
      { id: 'klappen', label: 'Klappen', icon: this.icon('tabler:layout-grid') },
      { id: 'modi', label: 'Modi', icon: this.icon('tabler:calendar') },
      { id: 'notizen', label: 'Notizen', icon: this.icon('tabler:notes') },
      { id: 'einstellungen', label: 'Einstellungen', icon: this.icon('tabler:settings') },
      { id: 'sicherheit', label: 'Sicherheit', icon: this.icon('tabler:shield-lock') },
      { id: 'setup', label: 'Setup', icon: this.icon('tabler:tools') },
      { id: 'log', label: 'Log', icon: this.icon('tabler:menu-2') },
    ];
    return html`
      <div class="sidebar ${this.sidebarCollapsed ? 'collapsed' : ''}">
        <div class="sidebar-version">v${HKWebApp.getDisplayVersion()}</div>
        <button class="sidebar-toggle" @click=${() => this.toggleSidebar()} title="${this.sidebarCollapsed ? 'Sidebar erweitern' : 'Sidebar reduzieren'}">
          ${this.sidebarCollapsed 
            ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`
            : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`
          }
        </button>
        <div class="menu">
          ${tabs.map(
            (t) => html`
              <div
                class="menu-item ${this.activeTab === t.id ? 'active' : ''}"
                @click=${() => {
                  this.setTab(t.id);
                  // Auf mobilen Geräten Sidebar nach Klick schließen
                  if (window.matchMedia('(max-width: 768px)').matches) {
                    this.sidebarCollapsed = true;
                    localStorage.setItem('hkweb_sidebarCollapsed', 'true');
                  }
                }}
                title="${this.sidebarCollapsed ? t.label : ''}"
              >
                ${t.icon}
                ${!this.sidebarCollapsed ? html`<span class="menu-label">${t.label}</span>` : ''}
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  /** Modus-Zeile(n) auf der Klappen-Karte (gleiche Daten wie Tab „Modi“). */
  renderKlappenModusBlock(k) {
    if (!this.klappenModi) this.loadModi();
    const m = this.getKlappenModus(k.id);
    const mode = m.modus || 'manual';
    const label =
      mode === 'schedule' ? 'Zeitpläne' : mode === 'daynight' ? 'Tag/Nacht' : 'Manuell';

    if (mode === 'schedule') {
      const oz = (m.schedule?.oeffnenZeiten || []).filter((z) => z != null && String(z).trim() !== '');
      const sz = (m.schedule?.schliessenZeiten || []).filter((z) => z != null && String(z).trim() !== '');
      return html`
        <div class="klappen-modus-info klappen-modus-info--in-section">
          <div class="klappen-modus-row klappen-modus-head">
            <span class="klappen-modus-label">Modus</span>
            <span class="klappen-modus-value">${label}</span>
          </div>
          <div class="klappen-modus-schedule">
            <div class="klappen-modus-row">
              <span class="klappen-modus-k">Öffnen</span>
              <span class="klappen-modus-v">${oz.length ? oz.join(', ') : 'keine Zeiten hinterlegt'}</span>
            </div>
            <div class="klappen-modus-row">
              <span class="klappen-modus-k">Schließen</span>
              <span class="klappen-modus-v">${sz.length ? sz.join(', ') : 'keine Zeiten hinterlegt'}</span>
            </div>
          </div>
        </div>
      `;
    }

    if (mode === 'daynight') {
      const dn = m.daynight || {};
      const plz = dn.plz && String(dn.plz).trim() ? dn.plz : '—';
      const oOff = dn.offsetOeffnen ?? 0;
      const sOff = dn.offsetSchliessen ?? 0;
      return html`
        <div class="klappen-modus-info klappen-modus-info--in-section">
          <div class="klappen-modus-row klappen-modus-head">
            <span class="klappen-modus-label">Modus</span>
            <span class="klappen-modus-value">${label}</span>
          </div>
          <div class="klappen-modus-schedule">
            <div class="klappen-modus-row">
              <span class="klappen-modus-k">PLZ</span>
              <span class="klappen-modus-v">${plz}</span>
            </div>
            <div class="klappen-modus-row klappen-modus-row-wrap">
              <span class="klappen-modus-k">Sonne</span>
              <span class="klappen-modus-v"
                >Öffnen ${oOff >= 0 ? '+' : ''}${oOff} min · Schließen ${sOff >= 0 ? '+' : ''}${sOff} min</span
              >
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="klappen-modus-info klappen-modus-info--compact klappen-modus-info--in-section">
        <div class="klappen-modus-row klappen-modus-head">
          <span class="klappen-modus-label">Modus</span>
          <span class="klappen-modus-value">${label}</span>
        </div>
      </div>
    `;
  }

  renderKlappen() {
    const klappen = this.getKlappenConfig();
    const addonErr =
      typeof window !== 'undefined' && window.__HK_ADDON__ && window.__HK_ADDON_HA_LAST_ERROR__;
    return html`
      ${addonErr
        ? html`
            <div class="addon-connect-banner">
              <strong>Home Assistant API:</strong> ${addonErr}<br />
              <span class="addon-connect-hint"
                >Add-on-Log prüfen. Unter Add-on „Konfiguration“ muss <code>homeassistant_api</code> aktiv sein; danach Add-on neu starten.</span
              >
            </div>
          `
        : ''}
      <div class="content-header">
        <h1>Klappen</h1>
        <svg class="menu-icon" viewBox="0 0 24 24"><path fill="#3a4252" d="M3 6h18M3 12h18M3 18h18"/></svg>
      </div>
      <div class="cards-row">
        ${klappen.map((k) => this.renderKlappenCard(k))}
      </div>
    `;
  }

  renderKlappenCard(k) {
    // Status aus Text-Sensor lesen (für HK1)
    const status = k.statusEntity ? this.getStatusFromTextSensor(k.statusEntity) : null;
    const zustand = k.zustandEntity ? this.getStatusFromTextSensor(k.zustandEntity) : null;
    const lastAction = k.lastActionEntity ? this.getStatusFromTextSensor(k.lastActionEntity) : null;
    const lastActionWhen = k.lastActionEntity ? this.getEntityLastChangedFormatted(k.lastActionEntity) : null;
    // Basisspanne „vor Umrechnung“ (wird später bei Bedarf gemappt).
    // Fallback orientiert sich an der bisherigen Konfiguration (max ~400).
    let speedMin = 0;
    let speedMax = 400;
    let speedStep = 1;
    if (k.speedEntity && this.hass?.states?.[k.speedEntity]?.attributes) {
      const a = this.hass.states[k.speedEntity].attributes;
      if (a.min !== undefined) speedMin = Number(a.min);
      if (a.max !== undefined) speedMax = Number(a.max);
      if (a.step !== undefined) speedStep = Number(a.step);
    }

    // Gewünschte Remap-Regel:
    // neuer MIN  = alter MAX (aktuell z. B. 400%)
    // neuer MAX  = alter MAX + 200% (z. B. 600%)
    // Schutz: Falls HA/ESPHome bereits die neue Spanne liefert (max > ~400),
    // dann nicht doppelt umrechnen.
    if (k.id === 'hk1' && speedMax <= 400.0001) {
      const oldMax = speedMax;
      speedMin = oldMax;
      speedMax = oldMax + 200;
    }

    let speedValue = null;
    let accelValue = null;

    if (k.speedEntity) {
      let fromHa = this.parseNumericStateFromHass(k.speedEntity);
      const ovr = this._speedUiOverride[k.id];
      if (ovr) {
        if (fromHa !== null && Math.abs(fromHa - ovr.value) < 0.501) {
          delete this._speedUiOverride[k.id];
        } else if (Date.now() > ovr.until) {
          delete this._speedUiOverride[k.id];
        } else {
          fromHa = null;
          speedValue = ovr.value;
        }
      }
      if (speedValue === null) {
        if (fromHa !== null) {
          speedValue = Math.max(speedMin, Math.min(speedMax, fromHa));
          localStorage.setItem(`hkweb_speed_${k.id}`, String(speedValue));
        } else {
          const savedSpeed = localStorage.getItem(`hkweb_speed_${k.id}`);
          const parsed = savedSpeed !== null ? Number(savedSpeed) : 400;
          speedValue = Number.isFinite(parsed) ? parsed : 400;
          speedValue = Math.max(speedMin, Math.min(speedMax, speedValue));
        }
      }
    }
    
    if (k.accelEntity) {
      if (this.hass?.states?.[k.accelEntity]?.state !== undefined) {
        accelValue = Number(this.hass.states[k.accelEntity].state);
        // Speichere den aktuellen Wert in localStorage für zukünftige Verwendung
        localStorage.setItem(`hkweb_accel_${k.id}`, accelValue.toString());
      } else {
        // Fallback: Lade aus localStorage
        const savedAccel = localStorage.getItem(`hkweb_accel_${k.id}`);
        accelValue = savedAccel !== null ? Number(savedAccel) : 50;
      }
    }

    const statusClass = this.getStatusClass(status || zustand);
    const displayStatus = status || zustand || 'Unbekannt';

    return html`
      <div class="glass-card">
        <div class="klappen-card-content">
          <input 
            type="text" 
            value="${k.name}" 
            class="klappen-name-input"
            @change=${e => this.handleKlappenNameChange(k.id, e)} 
          />
          
          <div class="status-indicator ${statusClass}">
            ${displayStatus}
          </div>

          <div class="klappen-card-sections">
            ${k.id === 'hk1' && k.lastActionEntity
              ? html`
                  <div class="klappen-card-section klappen-card-section--last-action">
                    <div class="klappen-card-section-title">Letzte Aktion</div>
                    <div class="klappen-card-section-body klappen-last-action-body">
                      ${lastAction || '—'}${lastActionWhen
                        ? html` <span class="status-detail-time">(${lastActionWhen})</span>`
                        : ''}
                    </div>
                  </div>
                `
              : ''}
            <div class="klappen-card-section klappen-card-section--modus">
              ${this.renderKlappenModusBlock(k)}
            </div>
            ${k.id === 'hk1' &&
            (k.endstopObenEntity || k.endstopUntenEntity || k.motorEnableEntity)
              ? html`
                  <div class="klappen-card-section klappen-card-section--hardware">
                    <div class="klappen-card-section-title">Endschalter &amp; Motor</div>
                    <div class="klappen-hardware-rows">
                      ${k.endstopObenEntity
                        ? html`<div class="klappen-hardware-row">
                            <span class="klappen-hardware-k">Oben</span>
                            <span>${this.formatHardwareEntityState(k.endstopObenEntity)}</span>
                          </div>`
                        : ''}
                      ${k.endstopUntenEntity
                        ? html`<div class="klappen-hardware-row">
                            <span class="klappen-hardware-k">Unten</span>
                            <span>${this.formatHardwareEntityState(k.endstopUntenEntity)}</span>
                          </div>`
                        : ''}
                      ${k.motorEnableEntity
                        ? html`<div class="klappen-hardware-row">
                            <span class="klappen-hardware-k">Motor</span>
                            <span>${this.formatHardwareEntityState(k.motorEnableEntity)}</span>
                          </div>`
                        : ''}
                    </div>
                  </div>
                `
              : ''}
          </div>

          <div class="button-group-main">
            ${k.buttonOeffnen ? html`
              <button class="glass-btn" @click=${() => this._callButtonService(k.buttonOeffnen)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l-8 8h6v8h4v-8h6z"/></svg>
                Öffnen
              </button>
            ` : ''}
            
            ${k.buttonSchliessen ? html`
              <button class="glass-btn" @click=${() => this._callButtonService(k.buttonSchliessen)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20l8-8h-6V4h-4v8H4z"/></svg>
                Schließen
              </button>
            ` : ''}
          </div>

          ${k.buttonStop ? html`
            <div class="button-group-stop">
              <button class="glass-btn glass-btn-stop" @click=${() => this._callButtonService(k.buttonStop)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
                Stop
              </button>
            </div>
          ` : ''}

          ${k.id === 'hk1' && (speedValue !== null || accelValue !== null) ? html`
            <div class="motor-params">
              <div class="motor-param-group">
                ${speedValue !== null ? html`
                  <div class="slider-label">Geschwindigkeit: ${speedValue}%</div>
                  <div class="slider-row">
                    <input 
                      type="range" 
                      min="${speedMin}" 
                      max="${speedMax}" 
                      step="${speedStep}" 
                      .value=${speedValue} 
                      @input=${e => this.setSpeedPercent(k, e)}
                      class="motor-slider"
                    >
                    <span class="slider-value">${speedValue}%</span>
                  </div>
                ` : ''}
                
                ${accelValue !== null ? html`
                  <div class="slider-label">Beschleunigung: ${accelValue}%</div>
                  <div class="slider-row">
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      step="1" 
                      .value=${accelValue} 
                      @input=${e => this.setAccelPercent(k, e)}
                      class="motor-slider"
                    >
                    <span class="slider-value">${accelValue}%</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderEinstellungen() {
    return html`
      <div class="settings-card">
        <div class="settings-title">Design Modus</div>
        <div class="theme-toggle-group">
          <button
            class="theme-toggle-btn ${this.theme === 'light' ? 'active' : ''}"
            @click=${() => this.setTheme('light')}
          >Light Mode</button>
          <button
            class="theme-toggle-btn ${this.theme === 'dark' ? 'active' : ''}"
            @click=${() => this.setTheme('dark')}
          >Dark Mode</button>
        </div>
        <div class="slider-group">
          <div class="slider-label">Kachel-Transparenz</div>
          <div class="slider-row">
            <input type="range" min="0.05" max="0.95" step="0.01" .value=${this.cardAlpha} @input=${this.setCardAlpha}>
            <span class="slider-value">${Math.round(this.cardAlpha * 100)}%</span>
          </div>
          <div class="slider-label">Sidebar-Transparenz</div>
          <div class="slider-row">
            <input type="range" min="0.05" max="0.95" step="0.01" .value=${this.sidebarAlpha} @input=${this.setSidebarAlpha}>
            <span class="slider-value">${Math.round(this.sidebarAlpha * 100)}%</span>
          </div>
        </div>
        <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.25);border:1.5px solid rgba(255,255,255,0.22);font-size:0.85rem;color:var(--liq-text, #2a2e3a);opacity:0.8;border-radius:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
          Passe die Transparenz der Kacheln und der Sidebar an.<br>
          Wähle zwischen hellem und dunklem Design.
        </div>

        <div class="settings-title" style="margin-top:24px">Einstellungen sichern</div>
        <div class="settings-card" style="margin-top:8px">
          <p class="einstellungen-sync-hint">
            <strong>Home-Assistant-Add-on:</strong> Änderungen werden automatisch nach
            <code class="inline-code">/data/hkweb-settings.json</code> auf dem HA-Gerät geschrieben und beim nächsten
            Start wieder geladen (Backup ohne manuellen Export).<br /><br />
            <strong>Optional (klassische Web-App):</strong> <code class="inline-code">hkweb-autosave.json</code> aus
            <code class="inline-code">www/hkweb/</code> wird nur geladen, wenn noch keine Add-on-Daten vorliegen —
            <strong>Export</strong>/<strong>Import</strong> für Datei-Backup und Umzug.
          </p>
          <div class="entity-input-row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
            <button type="button" class="glass-btn schedule-sync-btn" @click=${() => this.exportSettingsToFile()}>
              Export: hkweb-autosave.json
            </button>
            <button
              type="button"
              class="glass-btn schedule-sync-btn"
              style="opacity:0.95"
              @click=${() => this._openAutosaveImportPicker()}
            >
              Import aus Datei…
            </button>
            <input
              id="hkweb-autosave-file"
              type="file"
              accept="application/json,.json"
              style="display:none"
              @change=${(e) => this.importSettingsFromFile(e)}
            />
          </div>
        </div>
      </div>
    `;
  }

  renderModi() {
    const klappen = this.getKlappenConfig();
    if (!this.klappenModi) this.loadModi();
    
    return html`
      <div class="content-header">
        <h1>Modi</h1>
      </div>
      <div class="modi-klappen-container">
        ${klappen.map((k) => {
          const modusData = this.getKlappenModus(k.id);
          const currentModus = modusData.modus || 'manual';
          
          return html`
            <div class="glass-card modi-klappe-card">
              <div class="modi-klappe-header">
                <h2 class="modi-klappe-name">${k.name}</h2>
                <select 
                  class="modus-select"
                  .value="${currentModus}"
                  @change=${e => this.setKlappenModus(k.id, e.target.value)}
                >
                  <option value="schedule">Zeitpläne</option>
                  <option value="daynight">Tag/Nacht</option>
                  <option value="manual">Manuell</option>
                </select>
              </div>

              ${currentModus === 'schedule' ? this.renderScheduleSettings(k.id, modusData.schedule) : ''}
              ${currentModus === 'daynight' ? this.renderDayNightSettings(k.id, modusData.daynight) : ''}
              ${currentModus === 'manual' ? this.renderManualSettings(k.id, modusData.manual) : ''}
            </div>
          `;
        })}
      </div>
    `;
  }

  renderScheduleSettings(klappeId, scheduleData) {
    return html`
      <div class="modus-settings-expanded">
        <div class="settings-section">
          <h3 class="settings-section-title">Öffnungszeiten</h3>
          <div class="time-schedule-list">
            ${(scheduleData.oeffnenZeiten || []).map((zeit, index) => html`
              <div class="time-schedule-item">
                <input type="time" .value="${zeit}" @change=${e => {
                  const zeiten = [...(scheduleData.oeffnenZeiten || [])];
                  zeiten[index] = e.target.value;
                  this.updateKlappenModusEinstellung(klappeId, 'schedule', 'oeffnenZeiten', zeiten);
                }} />
                <button class="remove-time-btn" @click=${() => {
                  const zeiten = [...(scheduleData.oeffnenZeiten || [])];
                  zeiten.splice(index, 1);
                  this.updateKlappenModusEinstellung(klappeId, 'schedule', 'oeffnenZeiten', zeiten);
                }}>×</button>
              </div>
            `)}
            <button class="add-time-btn" @click=${() => {
              const zeiten = [...(scheduleData.oeffnenZeiten || []), '08:00'];
              this.updateKlappenModusEinstellung(klappeId, 'schedule', 'oeffnenZeiten', zeiten);
            }}>+ Öffnungszeit hinzufügen</button>
          </div>
        </div>
        <div class="settings-section">
          <h3 class="settings-section-title">Schließzeiten</h3>
          <div class="time-schedule-list">
            ${(scheduleData.schliessenZeiten || []).map((zeit, index) => html`
              <div class="time-schedule-item">
                <input type="time" .value="${zeit}" @change=${e => {
                  const zeiten = [...(scheduleData.schliessenZeiten || [])];
                  zeiten[index] = e.target.value;
                  this.updateKlappenModusEinstellung(klappeId, 'schedule', 'schliessenZeiten', zeiten);
                }} />
                <button class="remove-time-btn" @click=${() => {
                  const zeiten = [...(scheduleData.schliessenZeiten || [])];
                  zeiten.splice(index, 1);
                  this.updateKlappenModusEinstellung(klappeId, 'schedule', 'schliessenZeiten', zeiten);
                }}>×</button>
              </div>
            `)}
            <button class="add-time-btn" @click=${() => {
              const zeiten = [...(scheduleData.schliessenZeiten || []), '20:00'];
              this.updateKlappenModusEinstellung(klappeId, 'schedule', 'schliessenZeiten', zeiten);
            }}>+ Schließzeit hinzufügen</button>
          </div>
        </div>
        <div class="settings-section schedule-ha-actions">
          <p class="info-text">
            Die Zeiten werden lokal gespeichert; die Ausführung erfolgt in Home Assistant über Automatisierungen
            oder den Add-on-Scheduler — nicht über eine zentrale <code class="inline-code">input_text</code>-Hilfsentity.
          </p>
        </div>
      </div>
    `;
  }

  renderDayNightSettings(klappeId, daynightData) {
    const plz = daynightData.plz || '';
    const offsetOeffnen = daynightData.offsetOeffnen || 0;
    const offsetSchliessen = daynightData.offsetSchliessen || 0;
    
    // Berechne tatsächliche Zeiten mit Offsets
    let oeffnenZeit = '';
    let schliessenZeit = '';
    if (this.sunriseTime && this.sunsetTime && plz.length >= 5) {
      const [sunriseHour, sunriseMin] = this.sunriseTime.split(':').map(Number);
      const [sunsetHour, sunsetMin] = this.sunsetTime.split(':').map(Number);
      
      let oeffnenMin = sunriseMin + offsetOeffnen;
      let oeffnenHour = sunriseHour + Math.floor(oeffnenMin / 60);
      oeffnenMin = ((oeffnenMin % 60) + 60) % 60;
      oeffnenHour = ((oeffnenHour % 24) + 24) % 24;
      
      let schliessenMin = sunsetMin + offsetSchliessen;
      let schliessenHour = sunsetHour + Math.floor(schliessenMin / 60);
      schliessenMin = ((schliessenMin % 60) + 60) % 60;
      schliessenHour = ((schliessenHour % 24) + 24) % 24;
      
      oeffnenZeit = `${String(oeffnenHour).padStart(2, '0')}:${String(oeffnenMin).padStart(2, '0')}`;
      schliessenZeit = `${String(schliessenHour).padStart(2, '0')}:${String(schliessenMin).padStart(2, '0')}`;
    }
    
    return html`
      <div class="modus-settings-expanded">
        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">Postleitzahl:</label>
            <input 
              type="text" 
              class="plz-input"
              .value="${plz}"
              placeholder="12345"
              maxlength="5"
              @change=${e => this.updatePLZ(klappeId, e.target.value)}
            />
            ${plz.length >= 5 ? html`
              <button class="refresh-btn" @click=${() => this.fetchSunriseSunset()} title="Aktualisieren">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
            ` : ''}
          </div>
          ${this.sunriseTime && this.sunsetTime && plz.length >= 5 ? html`
            <div class="sun-times">
              <div class="sun-time">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                <span>Sonnenaufgang: ${this.sunriseTime}</span>
              </div>
              <div class="sun-time">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
                <span>Sonnenuntergang: ${this.sunsetTime}</span>
              </div>
            </div>
          ` : plz.length >= 5 ? html`
            <div class="loading-times">Lade Sonnenzeiten...</div>
          ` : ''}
        </div>
        
        <div class="settings-section">
          <h3 class="settings-section-title">Offset Einstellungen</h3>
          <div class="offset-settings">
            <div class="offset-row">
              <label class="offset-label">Öffnen (relativ zu Sonnenaufgang):</label>
              <select 
                class="offset-select"
                .value="${String(offsetOeffnen)}"
                @change=${e => this.updateKlappenModusEinstellung(klappeId, 'daynight', 'offsetOeffnen', Number(e.target.value))}
              >
                ${this.generateOffsetOptions()}
              </select>
              ${oeffnenZeit ? html`<span class="calculated-time">→ ${oeffnenZeit}</span>` : ''}
            </div>
            <div class="offset-row">
              <label class="offset-label">Schließen (relativ zu Sonnenuntergang):</label>
              <select 
                class="offset-select"
                .value="${String(offsetSchliessen)}"
                @change=${e => this.updateKlappenModusEinstellung(klappeId, 'daynight', 'offsetSchliessen', Number(e.target.value))}
              >
                ${this.generateOffsetOptions()}
              </select>
              ${schliessenZeit ? html`<span class="calculated-time">→ ${schliessenZeit}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  generateOffsetOptions() {
    const options = [];
    // -6 Stunden bis +6 Stunden in 30-Min-Schritten = -12 bis +12 (in 30-Min-Einheiten)
    for (let i = -12; i <= 12; i++) {
      const minutes = i * 30;
      const hours = Math.floor(Math.abs(minutes) / 60);
      const mins = Math.abs(minutes) % 60;
      let label = '';
      if (minutes === 0) {
        label = 'Kein Offset';
      } else if (minutes > 0) {
        if (hours > 0 && mins > 0) {
          label = `+${hours}h ${mins}min`;
        } else if (hours > 0) {
          label = `+${hours}h`;
        } else {
          label = `+${mins}min`;
        }
      } else {
        if (hours > 0 && mins > 0) {
          label = `-${hours}h ${mins}min`;
        } else if (hours > 0) {
          label = `-${hours}h`;
        } else {
          label = `-${mins}min`;
        }
      }
      options.push(html`<option value="${minutes}">${label}</option>`);
    }
    return options;
  }

  renderManualSettings(klappeId, manualData) {
    return html`
      <div class="modus-settings-expanded">
        <div class="settings-section">
          <label class="checkbox-label-large">
            <input 
              type="checkbox"
              .checked=${manualData.sicherheitsschliessen || false}
              @change=${e => this.updateKlappenModusEinstellung(klappeId, 'manual', 'sicherheitsschliessen', e.target.checked)}
            />
            <span>Sicherheitsschließzeiten anwenden</span>
          </label>
          <div class="info-text">
            Die Sicherheitsschließzeiten werden im Reiter "Sicherheit" definiert.
          </div>
        </div>
      </div>
    `;
  }

  getEntityReachabilityStatus(klappeId) {
    if (!this.entityValidation || !this.entityValidation[klappeId]) {
      return { status: 'Nicht geprüft', color: 'gray' };
    }
    
    const validation = this.entityValidation[klappeId];
    const values = Object.values(validation).filter(v => v !== null);
    
    if (values.length === 0) {
      return { status: 'Keine Entities', color: 'gray' };
    }
    
    const valid = values.filter(v => v === true).length;
    const invalid = values.filter(v => v === false).length;
    const total = values.length;
    
    if (invalid > 0) {
      return { status: `${invalid} Fehler`, color: 'red' };
    } else if (valid > 0) {
      return { status: `${valid}/${total} OK`, color: 'green' };
    } else {
      return { status: 'Nicht geprüft', color: 'gray' };
    }
  }

  renderSetup() {
    const klappen = this.getKlappenConfig();
    if (!this.entityValidation || Object.keys(this.entityValidation).length === 0) {
      this.entityValidation = this.validateAllEntities();
    }
    
    return html`
      <div class="content-header">
        <h1>Setup</h1>
        <div class="header-actions">
          <div class="klappen-status-overview">
            ${klappen.map(k => {
              const reachabilityInfo = this.getEntityReachabilityStatus(k.id);
              return html`
                <div class="klappe-status-badge" data-status="${reachabilityInfo.color}">
                  <span class="klappe-status-name">${k.name}</span>
                  <span class="klappe-status-value">${reachabilityInfo.status}</span>
                </div>
              `;
            })}
          </div>
          <button class="refresh-entities-btn" @click=${() => this.performEntityCheckWithProgress()} title="Entities prüfen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Entities prüfen
          </button>
        </div>
      </div>
      <div class="setup-container">
        ${klappen.map((k) => {
          const validation = this.entityValidation[k.id] || {};
          return html`
            <div class="glass-card setup-klappe-card">
              <div class="setup-klappe-header">
                <input 
                  type="text" 
                  value="${k.name}" 
                  class="setup-klappe-name"
                  @change=${e => {
                    this.updateKlappenConfig(k.id, 'name', e.target.value);
                    localStorage.setItem('klappen_name_' + k.id, e.target.value);
                  }}
                />
                <div class="entity-status-summary">
                  ${this.getEntityStatusSummary(validation)}
                </div>
              </div>

              <div class="setup-sections">
                <div class="setup-section">
                  <h3 class="setup-section-title">Text-Sensoren</h3>
                  ${this.renderEntityInput(k.id, 'statusEntity', 'Status', k.statusEntity, validation.statusEntity)}
                  ${this.renderEntityInput(k.id, 'zustandEntity', 'Zustand', k.zustandEntity, validation.zustandEntity)}
                  ${this.renderEntityInput(k.id, 'lastActionEntity', 'Letzte Aktion', k.lastActionEntity, validation.lastActionEntity)}
                  ${this.renderEntityInput(k.id, 'endstopObenEntity', 'Endschalter Oben', k.endstopObenEntity, validation.endstopObenEntity)}
                  ${this.renderEntityInput(k.id, 'endstopUntenEntity', 'Endschalter Unten', k.endstopUntenEntity, validation.endstopUntenEntity)}
                </div>

                <div class="setup-section">
                  <h3 class="setup-section-title">Buttons</h3>
                  ${this.renderEntityInput(k.id, 'buttonOeffnen', 'Öffnen', k.buttonOeffnen, validation.buttonOeffnen)}
                  ${this.renderEntityInput(k.id, 'buttonSchliessen', 'Schließen', k.buttonSchliessen, validation.buttonSchliessen)}
                  ${this.renderEntityInput(k.id, 'buttonStop', 'Stop', k.buttonStop, validation.buttonStop)}
                  ${this.renderEntityInput(k.id, 'buttonReset', 'Treiber Reset', k.buttonReset, validation.buttonReset)}
                  ${this.renderEntityInput(k.id, 'buttonZentrale', 'Zentrale', k.buttonZentrale, validation.buttonZentrale)}
                </div>

                <div class="setup-section">
                  <h3 class="setup-section-title">Motor-Parameter</h3>
                  ${this.renderEntityInput(k.id, 'speedEntity', 'Geschwindigkeit (%)', k.speedEntity, validation.speedEntity)}
                  ${this.renderEntityInput(k.id, 'accelEntity', 'Beschleunigung', k.accelEntity, validation.accelEntity)}
                  ${this.renderEntityInput(k.id, 'motorEnableEntity', 'Motor Enable', k.motorEnableEntity, validation.motorEnableEntity)}
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderEntityInput(klappeId, field, label, value, isValid) {
    return html`
      <div class="entity-input-row">
        <label class="entity-label">${label}:</label>
        <div class="entity-input-wrapper">
          <input 
            type="text" 
            class="entity-input ${isValid === false ? 'entity-invalid' : isValid === true ? 'entity-valid' : ''}"
            .value="${value || ''}"
            placeholder="z. B. sensor.hk1_status_hk1 / button.hk1_hk1_offnen"
            @change=${e => this.updateKlappenConfig(klappeId, field, e.target.value)}
          />
          ${isValid === true ? html`
            <span class="entity-status-icon entity-valid-icon" title="Entity gefunden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </span>
          ` : isValid === false ? html`
            <span class="entity-status-icon entity-invalid-icon" title="Entity nicht gefunden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
              </svg>
            </span>
          ` : value && isValid === null ? html`
            <span class="entity-status-icon entity-unknown-icon" title="Nicht geprüft">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
              </svg>
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }

  getEntityStatusSummary(validation) {
    if (!validation || Object.keys(validation).length === 0) {
      return html`<span class="status-badge status-unknown">Nicht geprüft</span>`;
    }
    const values = Object.values(validation).filter(v => v !== null);
    if (values.length === 0) {
      return html`<span class="status-badge status-unknown">Keine Entities</span>`;
    }
    const valid = values.filter(v => v === true).length;
    const invalid = values.filter(v => v === false).length;
    const total = values.length;
    
    if (invalid > 0) {
      return html`<span class="status-badge status-error">${invalid} Fehler</span>`;
    } else if (valid > 0) {
      return html`<span class="status-badge status-ok">${valid}/${total} OK</span>`;
    } else {
      return html`<span class="status-badge status-unknown">Nicht geprüft</span>`;
    }
  }

  renderLog() {
    const showAddonLog = typeof window !== 'undefined' && window.__HK_ADDON__;
    if (!showAddonLog) {
      return html`
        <div class="content-header"><h1>Log</h1></div>
        <div class="glass-card log-card">
          <h2>Letzte Änderungen in der App</h2>
          <ul class="log-list">
            ${this.logEntries.length === 0
              ? html`<li class="log-empty">Noch keine Änderungen protokolliert.</li>`
              : this.logEntries.map(
                  (e) => html`
                    <li class="log-entry">
                      <span class="log-time">[${e.ts}]</span> ${e.msg}
                    </li>
                  `,
                )}
          </ul>
        </div>
      `;
    }
    const isAddon = this.logPanelTab === 'addon';
    return html`
      <div class="content-header"><h1>Log</h1></div>
      <div class="log-subtabs glass-card">
        <button
          type="button"
          class="log-subtab ${!isAddon ? 'active' : ''}"
          @click=${() => {
            this.logPanelTab = 'app';
            this.requestUpdate();
          }}
        >
          App (Aktionen)
        </button>
        <button
          type="button"
          class="log-subtab ${isAddon ? 'active' : ''}"
          @click=${() => {
            this.logPanelTab = 'addon';
            this.requestUpdate();
          }}
        >
          Add-on (Server)
        </button>
        ${isAddon
          ? html`
              <button type="button" class="log-refresh-btn" @click=${() => this._refreshAddonLog()}>
                Aktualisieren
              </button>
            `
          : ''}
      </div>
      ${!isAddon
        ? html`
            <div class="glass-card log-card">
              <h2>Letzte Änderungen in der App</h2>
              <p class="log-panel-hint">Einträge aus Bedienung und Einstellungen (lokal im Browser).</p>
              <ul class="log-list">
                ${this.logEntries.length === 0
                  ? html`<li class="log-empty">Noch keine Änderungen protokolliert.</li>`
                  : this.logEntries.map(
                      (e) => html`
                        <li class="log-entry">
                          <span class="log-time">[${e.ts}]</span> ${e.msg}
                        </li>
                      `,
                    )}
              </ul>
            </div>
          `
        : html`
            <div class="glass-card log-card log-card-addon">
              <h2>Add-on-Server (Node)</h2>
              <p class="log-panel-hint">
                Ausgaben des Add-on-Prozesses (REST-Proxy, Speichern nach /data, Fehler). Zum Teilen mit Support
                kopieren.
              </p>
              <pre class="log-addon-pre">${(this.addonLogLines || []).join('\n')}</pre>
            </div>
          `}
    `;
  }

  renderNotizen() {
    return html`
      <div class="content-header">
        <h1>Notizen</h1>
      </div>
      <div class="glass-card glass-card--notizen">
        <p class="notizen-hint">
          Text wird lokal im Browser gehalten und im <strong>Home-Assistant-Add-on</strong> zusätzlich mit den
          Einstellungen unter <code>/data/hkweb-settings.json</code> gesichert.
        </p>
        <textarea
          class="notizen-textarea"
          .value=${this.userNotes}
          @input=${(e) => this.updateUserNotes(e.target.value)}
          placeholder="Listen, Termine, Hinweise zur Klappe …"
          spellcheck="true"
          rows="16"
        ></textarea>
      </div>
    `;
  }

  renderContent() {
    switch (this.activeTab) {
      case 'klappen':
        return this.renderKlappen();
      case 'setup':
        return this.renderSetup();
      case 'modi':
        return this.renderModi();
      case 'notizen':
        return this.renderNotizen();
      case 'einstellungen':
        return this.renderEinstellungen();
      case 'log':
        return this.renderLog();
      default:
        return html`
          <div class="content-header">
            <h1>${this.activeTab.charAt(0).toUpperCase() + this.activeTab.slice(1)}</h1>
          </div>
          <div class="glass-card">
            <p style="color: var(--liq-text, #2a2e3a); opacity: 0.7;">
              Inhalt folgt...
            </p>
          </div>
        `;
    }
  }

  static get styles() {
    return css`
      :host {
        display: flex;
        height: 100vh;
        font-family: 'SF Pro Display', 'Roboto', Arial, sans-serif;
        background: var(--liq-bg, linear-gradient(135deg, #e3e9f3 0%, #cfd8e6 100%));
        color: var(--liq-text, #2a2e3a);
        box-sizing: border-box;
      }
      .container {
        display: flex;
        width: 100vw;
        height: 100vh;
        border-radius: 20px;
        box-shadow: 0 8px 32px 0 var(--liq-shadow, rgba(31, 38, 135, 0.18));
        overflow: hidden;
      }
      @media (max-width: 768px) {
        .container {
          border-radius: 0;
        }
      }
      .sidebar {
        width: 220px;
        background: var(--liq-sidebar, rgba(255,255,255,0.18));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 20px 0 0 20px;
        box-shadow: 0 4px 24px 0 var(--liq-shadow, rgba(31, 38, 135, 0.10));
        display: flex;
        flex-direction: column;
        padding: 16px 0 0 0;
        gap: 8px;
        transition: width 0.3s ease;
        position: relative;
      }
      .sidebar.collapsed {
        width: 70px;
      }
      .sidebar-version {
        position: absolute;
        top: 12px;
        left: 12px;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--liq-text, #3a4252);
        opacity: 0.6;
        z-index: 5;
        padding: 4px 8px;
        background: rgba(255,255,255,0.2);
        border-radius: 6px;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        transition: opacity 0.2s;
      }
      .sidebar-version:hover {
        opacity: 0.9;
      }
      .sidebar.collapsed .sidebar-version {
        font-size: 0.6rem;
        padding: 3px 6px;
        left: 8px;
      }
      .sidebar-overlay {
        display: none;
      }
      @media (max-width: 768px) {
        .sidebar {
          border-radius: 0;
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          z-index: 1000;
          box-shadow: 2px 0 12px rgba(0,0,0,0.15);
        }
        .sidebar.collapsed {
          width: 60px;
        }
        .sidebar-overlay {
          display: block;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 999;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .content {
          margin-left: 0;
          width: 100%;
        }
      }
      .sidebar-toggle {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 36px;
        height: 36px;
        border: none;
        background: rgba(255,255,255,0.3);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--liq-text, #3a4252);
        transition: all 0.2s;
        z-index: 10;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .sidebar-toggle:hover {
        background: rgba(0,122,255,0.2);
        color: #007aff;
      }
      .sidebar.collapsed .sidebar-toggle {
        right: 8px;
      }
      .sidebar .menu {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 48px;
        padding: 0 8px;
      }
      .sidebar.collapsed .menu {
        padding: 0 4px;
      }
      .sidebar .menu-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--liq-text, #3a4252);
        cursor: pointer;
        transition: background 0.2s, color 0.2s, padding 0.3s;
        white-space: nowrap;
        overflow: hidden;
      }
      .sidebar.collapsed .menu-item {
        padding: 12px;
        justify-content: center;
      }
      .sidebar .menu-item.active,
      .sidebar .menu-item:hover {
        background: rgba(0,0,0,0.10);
        color: #007aff;
      }
      .sidebar .menu-item svg {
        width: 22px;
        height: 22px;
        opacity: 0.8;
        flex-shrink: 0;
      }
      .menu-label {
        transition: opacity 0.3s;
      }
      .sidebar.collapsed .menu-label {
        display: none;
      }
      .content {
        flex: 1;
        padding: 48px 32px;
        display: flex;
        flex-direction: column;
        background: transparent;
        overflow-y: auto;
      }
      @media (max-width: 768px) {
        /* Sidebar ist position:fixed → Inhalt ohne Einrückung liegt darunter */
        .container.sidebar-strip-narrow .content {
          margin-left: 60px;
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          padding: 20px 14px 28px 14px;
        }
        .container.sidebar-strip-wide .content {
          margin-left: 220px;
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          padding: 20px 14px 28px 14px;
        }
      }
      .content-header h1 {
        font-size: 2.2rem;
        font-weight: 700;
        margin: 0 0 24px 0;
        color: var(--liq-text, #2a2e3a);
      }
      @media (max-width: 768px) {
        .content-header h1 {
          font-size: 1.6rem;
          margin: 0 0 16px 0;
        }
        .content-header {
          flex-direction: column;
          align-items: flex-start;
        }
      }
      .addon-connect-banner {
        margin-bottom: 16px;
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(200, 60, 60, 0.12);
        border: 1px solid rgba(200, 60, 60, 0.35);
        color: var(--liq-text, #2a2e3a);
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .addon-connect-hint {
        opacity: 0.9;
        font-size: 0.82rem;
      }
      .addon-connect-banner code {
        font-size: 0.85em;
      }
      .cards-row {
        display: flex;
        gap: 48px;
        margin-top: 24px;
        flex-wrap: wrap;
      }
      @media (max-width: 768px) {
        .cards-row {
          flex-direction: column;
          gap: 24px;
          align-items: stretch;
        }
      }
      .glass-card {
        background: var(--liq-card, rgba(255,255,255,0.25));
        border-radius: 30px;
        box-shadow: 0 12px 48px 0 var(--liq-shadow, rgba(31, 38, 135, 0.15));
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1.5px solid rgba(255,255,255,0.22);
        padding: 48px 42px;
        min-width: 300px;
        max-width: 330px;
        display: flex;
        flex-direction: column;
        align-items: center;
        transition: box-shadow 0.3s;
      }
      @media (max-width: 768px) {
        .glass-card {
          min-width: auto;
          max-width: 100%;
          width: 100%;
          padding: 28px 20px;
          border: 2px solid rgba(255, 255, 255, 0.45);
          box-shadow:
            0 10px 36px var(--liq-shadow, rgba(31, 38, 135, 0.18)),
            inset 0 1px 0 rgba(255, 255, 255, 0.45);
        }
      }
      .glass-card--notizen {
        max-width: min(720px, 100%);
        width: 100%;
        align-self: stretch;
        align-items: stretch;
        padding-top: 28px;
        padding-bottom: 28px;
      }
      .notizen-hint {
        margin: 0 0 16px 0;
        font-size: 0.85rem;
        line-height: 1.45;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.88;
        text-align: left;
        width: 100%;
      }
      .notizen-hint code {
        font-size: 0.8rem;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.06);
      }
      .notizen-textarea {
        width: 100%;
        display: block;
        box-sizing: border-box;
        min-height: 260px;
        resize: vertical;
        font-family: inherit;
        font-size: 1rem;
        line-height: 1.5;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1.5px solid rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.45);
        color: var(--liq-text, #2a2e3a);
        outline: none;
      }
      .notizen-textarea:focus {
        border-color: #007aff;
        box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
      }
      .glass-card:hover {
        box-shadow: 0 16px 56px 0 var(--liq-shadow, rgba(31, 38, 135, 0.20));
      }
      .klappen-card-content {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .klappen-name-input {
        font-size: 1.5rem;
        font-weight: 700;
        text-align: center;
        width: 90%;
        margin-bottom: 20px;
        padding: 10px 14px;
        border: none;
        background: transparent;
        color: var(--liq-text, #2a2e3a);
        outline: none;
      }
      .status-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 80%;
        min-width: 160px;
        min-height: 60px;
        margin-bottom: 36px;
        border-radius: 16px;
        font-size: 1.3rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        box-shadow: 0 2px 12px rgba(31, 38, 135, 0.10);
        background: rgba(255,255,255,0.55);
        border: 1.5px solid rgba(255,255,255,0.25);
        transition: background 0.3s, color 0.3s;
        animation: none;
      }
      .status-indicator.offen {
        color: #ff3b30;
        background: rgba(255, 59, 48, 0.12);
        animation: pulse-red 3s ease-in-out infinite;
        border: 2px solid #ffb3ad;
      }
      .status-indicator.geschlossen {
        color: #27c93f;
        background: rgba(39, 201, 63, 0.12);
        animation: pulse-green 3s ease-in-out infinite;
        border: 2px solid #b6f7c1;
      }
      .status-indicator.in-bewegung {
        color: #ff9500;
        background: rgba(255, 149, 0, 0.12);
        animation: pulse-orange 3s ease-in-out infinite;
        border: 2px solid #ffd699;
      }
      .status-indicator.stoerung {
        color: #c41e1e;
        background: rgba(255, 59, 48, 0.18);
        border: 2px solid #ff3b30;
        animation: pulse-stoerung 1.1s ease-in-out infinite;
      }
      @keyframes pulse-red {
        0% { box-shadow: 0 0 0 0 rgba(255,59,48,0.25);}
        70% { box-shadow: 0 0 24px 12px rgba(255,59,48,0.18);}
        100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.25);}
      }
      @keyframes pulse-green {
        0% { box-shadow: 0 0 0 0 rgba(39,201,63,0.22);}
        70% { box-shadow: 0 0 24px 12px rgba(39,201,63,0.15);}
        100% { box-shadow: 0 0 0 0 rgba(39,201,63,0.22);}
      }
      @keyframes pulse-orange {
        0% { box-shadow: 0 0 0 0 rgba(255,149,0,0.25);}
        70% { box-shadow: 0 0 24px 12px rgba(255,149,0,0.18);}
        100% { box-shadow: 0 0 0 0 rgba(255,149,0,0.25);}
      }
      @keyframes pulse-stoerung {
        0% {
          box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.55);
          filter: brightness(1);
        }
        50% {
          box-shadow: 0 0 28px 14px rgba(255, 59, 48, 0.45);
          filter: brightness(1.08);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.55);
          filter: brightness(1);
        }
      }
      .status-details {
        width: 90%;
        margin-bottom: 20px;
        padding: 12px;
        background: rgba(255,255,255,0.35);
        border: 1px solid rgba(255,255,255,0.25);
        font-size: 0.9rem;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        color: var(--liq-text, #2a2e3a);
        border-radius: 12px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .status-detail {
        margin-bottom: 6px;
        padding: 4px 0;
        border-bottom: 1px dotted rgba(0,0,0,0.1);
      }
      .status-detail:last-child {
        border-bottom: none;
        margin-bottom: 0;
      }
      .status-detail-time {
        opacity: 0.85;
        font-size: 0.92em;
        white-space: nowrap;
      }
      .klappen-card-sections {
        width: 90%;
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 8px;
      }
      .klappen-card-section {
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.2);
        box-shadow: 0 2px 10px rgba(31, 38, 135, 0.07);
        color: var(--liq-text, #2a2e3a);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .klappen-card-section--last-action {
        border-color: rgba(0, 122, 255, 0.22);
        background: rgba(0, 122, 255, 0.06);
      }
      .klappen-card-section--modus {
        border-color: rgba(142, 78, 198, 0.2);
        background: rgba(142, 78, 198, 0.07);
      }
      .klappen-card-section--hardware {
        border-color: rgba(39, 201, 63, 0.2);
        background: rgba(39, 201, 63, 0.06);
      }
      .klappen-card-section-title {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.72;
        margin-bottom: 8px;
      }
      .klappen-last-action-body {
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.4;
      }
      .klappen-modus-info--in-section {
        width: 100%;
        margin-bottom: 0;
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }
      .klappen-hardware-rows {
        font-size: 0.9rem;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .klappen-hardware-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
        padding: 4px 0;
        border-bottom: 1px dotted rgba(0, 0, 0, 0.1);
      }
      .klappen-hardware-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }
      .klappen-hardware-k {
        font-weight: 600;
        opacity: 0.78;
        flex: 0 0 auto;
        min-width: 4rem;
      }
      .klappen-modus-info {
        width: 90%;
        margin-bottom: 16px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.28);
        border: 1px solid rgba(255,255,255,0.22);
        font-size: 0.85rem;
        border-radius: 12px;
        color: var(--liq-text, #2a2e3a);
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.06);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .klappen-modus-info--compact {
        margin-bottom: 12px;
      }
      .klappen-modus-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 4px;
        line-height: 1.35;
      }
      .klappen-modus-row:last-child {
        margin-bottom: 0;
      }
      .klappen-modus-row-wrap {
        flex-wrap: wrap;
      }
      .klappen-modus-head {
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px dotted rgba(0,0,0,0.12);
        justify-content: space-between;
      }
      .klappen-modus-label {
        font-weight: 600;
        opacity: 0.85;
      }
      .klappen-modus-value {
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
      }
      .klappen-modus-k {
        flex: 0 0 auto;
        min-width: 4.5rem;
        font-weight: 600;
        opacity: 0.75;
      }
      .klappen-modus-v {
        flex: 1 1 auto;
        text-align: right;
        word-break: break-word;
      }
      .klappen-modus-schedule .klappen-modus-row {
        margin-bottom: 6px;
      }
      .button-group {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 90%;
        margin-top: 8px;
        align-items: center;
      }
      .button-group-main {
        display: flex;
        flex-direction: row;
        gap: 12px;
        width: 100%;
        margin-top: 16px;
        justify-content: center;
        align-items: center;
      }
      .button-group-main .glass-btn {
        flex: 1;
        min-width: 0;
        max-width: none;
      }
      .button-group-stop {
        display: flex;
        width: 100%;
        margin-top: 12px;
        justify-content: center;
        align-items: center;
      }
      .button-group-stop .glass-btn {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }
      .glass-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 70%;
        min-width: 120px;
        max-width: 180px;
        height: 60px;
        padding: 0;
        border: none;
        border-radius: 16px;
        background: rgba(255,255,255,0.45);
        color: var(--liq-text, #2a2e3a);
        font-size: 1.15rem;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
      }
      .glass-btn:hover {
        background: rgba(0,122,255,0.15);
        color: #007aff;
      }
      .glass-btn-stop {
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
      }
      .glass-btn-stop:hover {
        background: rgba(255, 59, 48, 0.25);
        color: #ff3b30;
      }
      .glass-btn-reset {
        background: rgba(255, 149, 0, 0.15);
        color: #ff9500;
      }
      .glass-btn-reset:hover {
        background: rgba(255, 149, 0, 0.25);
        color: #ff9500;
      }
      .glass-btn-zentrale {
        background: rgba(39, 201, 63, 0.15);
        color: #27c93f;
      }
      .glass-btn-zentrale:hover {
        background: rgba(39, 201, 63, 0.25);
        color: #27c93f;
      }
      .glass-btn img {
        width: 48px;
        height: 48px;
        border-radius: 10px;
        box-shadow: 0 1px 4px #0002;
        margin-right: 8px;
        object-fit: cover;
        background: #fff;
      }
      .motor-params {
        width: 90%;
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1.5px solid rgba(255,255,255,0.25);
        position: relative;
      }
      .motor-param-group {
        width: 100%;
      }
      .motor-slider {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border: none;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 2px;
        accent-color: #007aff;
      }
      .motor-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        background: #007aff;
        border: 2px solid rgba(255,255,255,0.5);
        box-shadow: 0 2px 4px rgba(0,122,255,0.3);
        cursor: pointer;
        border-radius: 50%;
      }
      .motor-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        background: #007aff;
        border: 2px solid rgba(255,255,255,0.5);
        box-shadow: 0 2px 4px rgba(0,122,255,0.3);
        cursor: pointer;
        border-radius: 50%;
      }
      .content-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
        flex-wrap: wrap;
        gap: 16px;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .klappen-status-overview {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .klappe-status-badge {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 16px;
        border-radius: 12px;
        border: 1.5px solid;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        min-width: 100px;
        transition: all 0.2s;
      }
      .klappe-status-badge[data-status="green"] {
        background: rgba(39, 201, 63, 0.15);
        color: #27c93f;
        border-color: #27c93f;
      }
      .klappe-status-badge[data-status="blue"] {
        background: rgba(0, 122, 255, 0.15);
        color: #007aff;
        border-color: #007aff;
      }
      .klappe-status-badge[data-status="orange"] {
        background: rgba(255, 149, 0, 0.15);
        color: #ff9500;
        border-color: #ff9500;
      }
      .klappe-status-badge[data-status="red"] {
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
        border-color: #ff3b30;
      }
      .klappe-status-badge[data-status="gray"] {
        background: rgba(142, 142, 147, 0.15);
        color: #8e8e93;
        border-color: #8e8e93;
      }
      .klappe-status-name {
        font-size: 0.75rem;
        font-weight: 600;
        opacity: 0.8;
        margin-bottom: 4px;
      }
      .klappe-status-value {
        font-size: 0.9rem;
        font-weight: 700;
      }
      .menu-icon {
        width: 28px;
        height: 28px;
        opacity: 0.5;
        cursor: pointer;
      }
      .settings-card {
        background: var(--liq-card, rgba(255,255,255,0.25));
        border-radius: 24px;
        box-shadow: 0 8px 32px 0 var(--liq-shadow, rgba(31, 38, 135, 0.12));
        padding: 36px 32px;
        min-width: 320px;
        max-width: 400px;
        margin-top: 32px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1.5px solid rgba(255,255,255,0.22);
      }
      .settings-title {
        font-size: 1.3rem;
        font-weight: 700;
        margin-bottom: 18px;
        color: var(--liq-text, #2a2e3a);
      }
      .theme-toggle-group {
        display: flex;
        gap: 18px;
        margin-bottom: 12px;
      }
      .theme-toggle-btn {
        padding: 10px 22px;
        border-radius: 10px;
        border: none;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        background: rgba(255,255,255,0.45);
        color: var(--liq-text, #2a2e3a);
        box-shadow: 0 1px 4px rgba(31, 38, 135, 0.08);
        transition: background 0.2s, color 0.2s;
      }
      .theme-toggle-btn.active,
      .theme-toggle-btn:hover {
        background: #007aff;
        color: #fff;
      }
      .theme-toggle-btn:active {
        box-shadow: 
          inset 0 4px 8px rgba(139, 115, 85, 0.2),
          0 1px 2px rgba(139, 115, 85, 0.2);
        transform: translateY(1px);
      }
      .slider-group {
        margin-top: 24px;
        width: 100%;
      }
      .slider-label {
        font-size: 1.05rem;
        font-weight: 500;
        margin-bottom: 4px;
        color: var(--liq-text, #2a2e3a);
      }
      .slider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .slider-row input[type="range"] {
        flex: 1;
        accent-color: #007aff;
        height: 4px;
      }
      .slider-value {
        min-width: 36px;
        text-align: right;
        font-size: 1rem;
        opacity: 0.7;
        color: var(--liq-text, #2a2e3a);
      }
      .log-subtabs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        margin-bottom: 12px;
        max-width: 900px;
        width: 100%;
      }
      .log-subtab {
        padding: 8px 16px;
        border-radius: 12px;
        border: 1.5px solid rgba(0, 0, 0, 0.12);
        background: rgba(255, 255, 255, 0.35);
        cursor: pointer;
        font-size: 0.9rem;
        color: var(--liq-text, #2a2e3a);
      }
      .log-subtab.active {
        background: rgba(0, 122, 255, 0.2);
        border-color: #007aff;
        font-weight: 600;
      }
      .log-refresh-btn {
        margin-left: auto;
        padding: 6px 12px;
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.15);
        background: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        font-size: 0.85rem;
        color: var(--liq-text, #2a2e3a);
      }
      .log-panel-hint {
        margin: 0 0 12px 0;
        font-size: 0.82rem;
        opacity: 0.85;
        line-height: 1.45;
        color: var(--liq-text, #2a2e3a);
      }
      .log-addon-pre {
        margin: 0;
        padding: 12px;
        font-size: 0.72rem;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: min(60vh, 520px);
        overflow: auto;
        background: rgba(0, 0, 0, 0.06);
        border-radius: 12px;
        font-family: ui-monospace, Consolas, 'Courier New', monospace;
        color: var(--liq-text, #2a2e3a);
      }
      .log-card-addon {
        max-width: 900px;
      }
      .log-card {
        max-width: 900px;
        width: 100%;
        align-items: flex-start;
      }
      .log-card h2 {
        font-weight: 700;
        margin-bottom: 20px;
        color: var(--liq-text, #2a2e3a);
      }
      .log-list {
        list-style: none;
        padding: 12px;
        margin: 0;
        width: 100%;
        max-height: 400px;
        overflow-y: auto;
        background: rgba(255,255,255,0.25);
        border: 1.5px solid rgba(255,255,255,0.22);
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 16px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .log-entry {
        margin-bottom: 8px;
        padding: 6px 8px;
        font-size: 0.9rem;
        border-bottom: 1px dotted rgba(0,0,0,0.1);
        color: var(--liq-text, #2a2e3a);
        opacity: 0.8;
      }
      .log-entry:last-child {
        border-bottom: none;
      }
      .log-time {
        font-size: 0.85em;
        color: #007aff;
        font-weight: 700;
        margin-right: 8px;
      }
      .log-empty {
        opacity: 0.6;
        font-style: italic;
        padding: 20px;
        text-align: center;
        color: var(--liq-text, #2a2e3a);
      }
      .einstellungen-sync-hint {
        margin: 0;
        font-size: 0.88rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.88;
        line-height: 1.45;
      }
      .modi-klappen-container {
        display: flex;
        flex-direction: column;
        gap: 24px;
        margin-top: 24px;
        width: 100%;
        max-width: 100%;
      }
      .modi-klappe-card {
        width: 100%;
        max-width: 100%;
        min-width: 100%;
        align-items: flex-start;
        box-sizing: border-box;
      }
      .modi-klappe-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      .modi-klappe-name {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
        margin: 0;
      }
      .modus-select {
        font-size: 1.1rem;
        font-weight: 600;
        padding: 10px 16px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        transition: all 0.2s;
        border-radius: 12px;
        cursor: pointer;
        min-width: 180px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .modus-select:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .modus-settings-expanded {
        width: 100%;
        margin-top: 20px;
        padding: 20px;
        background: rgba(255,255,255,0.25);
        border: 1.5px solid rgba(255,255,255,0.22);
        border-radius: 20px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 4px 16px rgba(31, 38, 135, 0.10);
      }
      .settings-section {
        margin-bottom: 24px;
      }
      .settings-section:last-child {
        margin-bottom: 0;
      }
      .settings-section-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      .setting-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .setting-label {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        min-width: 120px;
      }
      .plz-input {
        font-size: 1rem;
        padding: 8px 12px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 12px;
        width: 100px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .plz-input:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .sun-times {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px dotted var(--fallout-border, rgba(139, 115, 85, 0.3));
      }
      .sun-time {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.95rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.8;
      }
      .sun-time svg {
        color: #ff9500;
      }
      .schedule-info,
      .manual-info {
        font-size: 0.9rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.7;
        font-style: italic;
      }
      .time-schedule-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .time-schedule-item {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .time-schedule-item input[type="time"] {
        font-size: 1rem;
        padding: 8px 12px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 12px;
        min-width: 120px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .time-schedule-item input[type="time"]:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .remove-time-btn {
        width: 32px;
        height: 32px;
        border: 1.5px solid #ff3b30;
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
        font-size: 1.2rem;
        font-weight: 700;
        cursor: pointer;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .remove-time-btn:hover {
        background: #ff3b30;
        color: white;
      }
      .add-time-btn {
        font-size: 0.95rem;
        font-weight: 600;
        padding: 10px 16px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        cursor: pointer;
        border-radius: 12px;
        transition: all 0.2s;
        width: fit-content;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .add-time-btn:hover {
        background: rgba(0,122,255,0.15);
        color: #007aff;
        border-color: #007aff;
      }
      .refresh-btn {
        width: 36px;
        height: 36px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        cursor: pointer;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        padding: 0;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .refresh-btn:hover {
        background: rgba(0,122,255,0.15);
        color: #007aff;
        border-color: #007aff;
      }
      .loading-times {
        font-size: 0.9rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.7;
        font-style: italic;
        padding: 12px;
      }
      .offset-settings {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .offset-row {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .offset-label {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        min-width: 250px;
      }
      .offset-select {
        font-size: 0.95rem;
        padding: 8px 12px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 12px;
        cursor: pointer;
        min-width: 180px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .offset-select:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .calculated-time {
        font-size: 0.95rem;
        font-weight: 700;
        color: #007aff;
        padding: 6px 12px;
        background: rgba(0,122,255,0.1);
        border-radius: 12px;
      }
      .checkbox-label-large {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 1rem;
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        cursor: pointer;
        padding: 12px;
        border-radius: 12px;
        transition: all 0.2s;
      }
      .checkbox-label-large:hover {
        background: rgba(0,0,0,0.05);
      }
      .checkbox-label-large input[type="checkbox"] {
        width: 24px;
        height: 24px;
        cursor: pointer;
        accent-color: #007aff;
      }
      .checkbox-label-large span {
        user-select: none;
      }
      .info-text {
        font-size: 0.85rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.7;
        font-style: italic;
        margin-top: 8px;
        padding-left: 36px;
      }
      .inline-code {
        font-family: ui-monospace, monospace;
        font-size: 0.85em;
        font-style: normal;
        opacity: 1;
      }
      .schedule-sync-info {
        padding-left: 0;
        margin-bottom: 8px;
      }
      .schedule-ha-actions {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }
      .schedule-ha-actions .info-text {
        padding-left: 0;
      }
      .schedule-sync-btn {
        margin-top: 10px;
      }
      .setup-container {
        display: flex;
        flex-direction: column;
        gap: 24px;
        margin-top: 24px;
        width: 100%;
      }
      .setup-klappe-card {
        width: 100%;
        max-width: 100%;
        align-items: flex-start;
      }
      .setup-klappe-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      .setup-klappe-name {
        font-size: 1.5rem;
        font-weight: 700;
        padding: 10px 14px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 12px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        min-width: 200px;
      }
      .setup-klappe-name:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .entity-status-summary {
        display: flex;
        gap: 8px;
      }
      .status-badge {
        padding: 6px 12px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        border: 1.5px solid;
      }
      .status-badge.status-ok {
        background: rgba(39, 201, 63, 0.15);
        color: #27c93f;
        border-color: #27c93f;
      }
      .status-badge.status-error {
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
        border-color: #ff3b30;
      }
      .status-badge.status-unknown {
        background: rgba(142, 142, 147, 0.15);
        color: #8e8e93;
        border-color: #8e8e93;
      }
      .refresh-entities-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        border-radius: 12px;
        transition: all 0.2s;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .refresh-entities-btn:hover {
        background: rgba(0,122,255,0.15);
        color: #007aff;
        border-color: #007aff;
      }
      .setup-sections {
        display: flex;
        flex-direction: column;
        gap: 24px;
        width: 100%;
      }
      .setup-section {
        padding: 20px;
        background: rgba(255,255,255,0.15);
        border: 1.5px solid rgba(255,255,255,0.2);
        border-radius: 16px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .setup-section-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      @media (max-width: 768px) {
        .setup-section {
          border: 2px solid rgba(255, 255, 255, 0.42);
          box-shadow: 0 6px 22px rgba(31, 38, 135, 0.12);
        }
      }
      .entity-input-row {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
      }
      .entity-label {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        min-width: 140px;
      }
      .entity-input-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
      }
      .entity-input {
        flex: 1;
        font-size: 0.95rem;
        padding: 8px 12px;
        border: 1.5px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.35);
        color: var(--liq-text, #2a2e3a);
        outline: none;
        box-shadow: 0 2px 8px rgba(31, 38, 135, 0.08);
        border-radius: 12px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        font-family: 'Courier New', monospace;
      }
      .entity-input:focus {
        border-color: #007aff;
        box-shadow: 0 4px 12px rgba(0,122,255,0.15);
      }
      .entity-input.entity-valid {
        border-color: #27c93f;
        background: rgba(39, 201, 63, 0.1);
      }
      .entity-input.entity-invalid {
        border-color: #ff3b30;
        background: rgba(255, 59, 48, 0.1);
      }
      .entity-status-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .entity-valid-icon {
        color: #27c93f;
      }
      .entity-invalid-icon {
        color: #ff3b30;
      }
      .entity-unknown-icon {
        color: #8e8e93;
        opacity: 0.6;
      }
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
        animation: fadeIn 0.2s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .entity-check-modal {
        background: var(--liq-card, rgba(255,255,255,0.95));
        border-radius: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1.5px solid rgba(255,255,255,0.3);
        max-width: 800px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        animation: slideUp 0.3s ease;
      }
      @keyframes slideUp {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 32px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      .modal-header h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
      }
      .modal-close-btn {
        width: 36px;
        height: 36px;
        border: none;
        background: rgba(255,255,255,0.3);
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--liq-text, #2a2e3a);
        transition: all 0.2s;
      }
      .modal-close-btn:hover {
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
      }
      .check-progress {
        padding: 32px;
      }
      .progress-bar-container {
        width: 100%;
        height: 8px;
        background: rgba(0,0,0,0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 16px;
      }
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #007aff, #5ac8fa);
        border-radius: 4px;
        transition: width 0.3s ease;
      }
      .progress-text {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .progress-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .progress-info strong {
        font-size: 1.1rem;
        color: var(--liq-text, #2a2e3a);
      }
      .progress-info span {
        font-size: 0.9rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.7;
      }
      .progress-count {
        font-size: 0.9rem;
        font-weight: 600;
        color: #007aff;
      }
      .check-results {
        padding: 32px;
        overflow-y: auto;
        flex: 1;
      }
      .check-summary {
        margin-bottom: 32px;
        padding: 20px;
        background: rgba(255,255,255,0.3);
        border-radius: 16px;
        border: 1.5px solid rgba(255,255,255,0.2);
      }
      .check-summary h3 {
        margin: 0 0 16px 0;
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
      }
      .summary-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .stat-item {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border-radius: 12px;
        border: 1.5px solid;
      }
      .stat-valid {
        background: rgba(39, 201, 63, 0.15);
        border-color: #27c93f;
        color: #27c93f;
      }
      .stat-invalid {
        background: rgba(255, 59, 48, 0.15);
        border-color: #ff3b30;
        color: #ff3b30;
      }
      .stat-not-configured {
        background: rgba(142, 142, 147, 0.15);
        border-color: #8e8e93;
        color: #8e8e93;
      }
      .stat-total {
        background: rgba(0, 122, 255, 0.15);
        border-color: #007aff;
        color: #007aff;
      }
      .stat-label {
        font-size: 0.85rem;
        opacity: 0.8;
        margin-bottom: 4px;
      }
      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
      }
      .entity-check-actions {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(0,0,0,0.08);
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }
      .entity-repair-hint {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.45;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.85;
      }
      .entity-repair-hint code {
        font-size: 0.8rem;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(0,0,0,0.06);
        font-family: 'Courier New', monospace;
      }
      .entity-auto-repair-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .check-klappen-list {
        display: flex;
        flex-direction: column;
        gap: 24px;
        margin-bottom: 32px;
      }
      .check-klappe-section {
        padding: 20px;
        background: rgba(255,255,255,0.2);
        border-radius: 16px;
        border: 1.5px solid rgba(255,255,255,0.2);
      }
      .klappe-section-title {
        margin: 0 0 16px 0;
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--liq-text, #2a2e3a);
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(0,0,0,0.1);
      }
      .check-category {
        margin-bottom: 20px;
      }
      .check-category:last-child {
        margin-bottom: 0;
      }
      .category-title {
        margin: 0 0 12px 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.8;
      }
      .entity-checklist {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .checklist-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255,255,255,0.2);
        border: 1.5px solid;
        transition: all 0.2s;
      }
      .checklist-item.item-valid {
        border-color: #27c93f;
        background: rgba(39, 201, 63, 0.1);
      }
      .checklist-item.item-invalid {
        border-color: #ff3b30;
        background: rgba(255, 59, 48, 0.1);
      }
      .checklist-icon {
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .checklist-item.item-valid .checklist-icon {
        color: #27c93f;
      }
      .checklist-item.item-invalid .checklist-icon {
        color: #ff3b30;
      }
      .checklist-label {
        font-weight: 600;
        color: var(--liq-text, #2a2e3a);
        min-width: 140px;
      }
      .checklist-entity {
        font-family: 'Courier New', monospace;
        font-size: 0.85rem;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.7;
        flex: 1;
        text-align: right;
      }
      .klappe-errors {
        margin-top: 16px;
        padding: 16px;
        background: rgba(255, 59, 48, 0.1);
        border-radius: 12px;
        border: 1.5px solid #ff3b30;
      }
      .errors-title {
        margin: 0 0 8px 0;
        font-size: 0.95rem;
        font-weight: 700;
        color: #ff3b30;
      }
      .errors-list {
        margin: 0;
        padding-left: 20px;
        list-style: disc;
      }
      .error-item {
        margin-bottom: 4px;
        font-size: 0.9rem;
        color: var(--liq-text, #2a2e3a);
      }
      .check-error-report {
        margin-top: 32px;
        padding: 24px;
        background: rgba(255, 59, 48, 0.1);
        border-radius: 16px;
        border: 1.5px solid #ff3b30;
      }
      .check-error-report h3 {
        margin: 0 0 16px 0;
        font-size: 1.2rem;
        font-weight: 700;
        color: #ff3b30;
      }
      .error-report-intro {
        margin: 0 0 12px 0;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.8;
      }
      .error-report-list {
        margin: 0;
        padding-left: 20px;
        list-style: disc;
      }
      .error-report-item {
        margin-bottom: 8px;
        color: var(--liq-text, #2a2e3a);
      }
      .error-report-item code {
        background: rgba(0,0,0,0.1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
      }
      .check-success {
        margin-top: 32px;
        padding: 32px;
        text-align: center;
        background: rgba(39, 201, 63, 0.1);
        border-radius: 16px;
        border: 1.5px solid #27c93f;
      }
      .check-success svg {
        color: #27c93f;
        margin-bottom: 16px;
      }
      .check-success p {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #27c93f;
      }
      .check-empty {
        padding: 40px;
        text-align: center;
        color: var(--liq-text, #2a2e3a);
        opacity: 0.6;
      }
      @media (max-width: 768px) {
        .entity-check-modal {
          max-width: 100%;
          max-height: 100vh;
          border-radius: 0;
        }
        .modal-header {
          padding: 20px;
        }
        .check-results {
          padding: 20px;
        }
        .summary-stats {
          grid-template-columns: repeat(2, 1fr);
        }
        .checklist-item {
          flex-wrap: wrap;
        }
        .checklist-entity {
          width: 100%;
          text-align: left;
          margin-top: 4px;
        }
      }
    `;
  }

  icon(name) {
    const iconColor = 'currentColor';
    switch (name) {
      case 'tabler:layout-grid':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>`;
      case 'tabler:calendar':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4" stroke-linecap="round"/></svg>`;
      case 'tabler:notes':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2"/><path d="M9 3v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3"/><path d="M9 12h6M9 16h6"/></svg>`;
      case 'tabler:settings':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      case 'tabler:shield-lock':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><path d="M12 3l7 4v5c0 5-3.5 9-7 9s-7-4-7-9V7z"/><circle cx="12" cy="13" r="2" fill="${iconColor}"/><path d="M12 15v2" stroke-linecap="round"/></svg>`;
      case 'tabler:menu-2':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg>`;
      case 'tabler:tools':
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
      default:
        return html``;
    }
  }

  isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  renderEntityCheckModal() {
    if (!this.showEntityCheckModal) return html``;

    const progress = this.entityCheckProgress;
    const results = this.entityCheckResults;
    const isChecking = progress.total > 0 && progress.current < progress.total;

    return html`
      <div class="modal-overlay" @click=${(e) => {
        if (e.target.classList.contains('modal-overlay') && !isChecking) {
          this.showEntityCheckModal = false;
          this.requestUpdate();
        }
      }}>
        <div class="modal-content entity-check-modal">
          <div class="modal-header">
            <h2>Entity-Prüfung</h2>
            ${!isChecking ? html`
              <button class="modal-close-btn" @click=${() => {
                this.showEntityCheckModal = false;
                this.requestUpdate();
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            ` : ''}
          </div>

          ${isChecking ? html`
            <div class="check-progress">
              <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${(progress.current / progress.total) * 100}%"></div>
              </div>
              <div class="progress-text">
                <div class="progress-info">
                  <strong>${progress.currentKlappe}</strong>
                  <span>${progress.currentEntity}</span>
                </div>
                <div class="progress-count">${progress.current} / ${progress.total}</div>
              </div>
            </div>
          ` : html`
            <div class="check-results">
              ${this.renderEntityCheckResults(results)}
            </div>
          `}
        </div>
      </div>
    `;
  }

  renderEntityCheckResults(results) {
    if (!results || !results.klappen || results.klappen.length === 0) {
      return html`<div class="check-empty">Keine Ergebnisse verfügbar</div>`;
    }

    return html`
      <div class="check-summary">
        <h3>Zusammenfassung</h3>
        <div class="summary-stats">
          <div class="stat-item stat-valid">
            <span class="stat-label">Gefunden:</span>
            <span class="stat-value">${results.summary.valid}</span>
          </div>
          <div class="stat-item stat-invalid">
            <span class="stat-label">Fehler:</span>
            <span class="stat-value">${results.summary.invalid}</span>
          </div>
          <div class="stat-item stat-not-configured">
            <span class="stat-label">Nicht konfiguriert:</span>
            <span class="stat-value">${results.summary.notConfigured}</span>
          </div>
          <div class="stat-item stat-total">
            <span class="stat-label">Gesamt:</span>
            <span class="stat-value">${results.summary.total}</span>
          </div>
        </div>
        ${results.summary.invalid > 0 ? html`
          <div class="entity-check-actions">
            <p class="entity-repair-hint">
              Auto-Reparatur setzt fehlerhafte IDs auf die Baseline (<code>HOME ASSISTANT ENTITÄTEN.md</code>) bzw. die erste passende Entity in Home Assistant (z.&nbsp;B. falsch <code>sensor.hk1_hk1_status</code> → richtig <code>sensor.hk1_status_hk1</code>).
            </p>
            <button
              type="button"
              class="refresh-entities-btn entity-auto-repair-btn"
              ?disabled=${this.entityAutoRepairBusy}
              @click=${() => this.performAutoRepairFromEntityCheck()}
            >
              ${this.entityAutoRepairBusy ? 'Reparatur…' : 'Auto-Reparatur'}
            </button>
          </div>
        ` : ''}
      </div>

      <div class="check-klappen-list">
        ${results.klappen.map(klappe => html`
          <div class="check-klappe-section">
            <h4 class="klappe-section-title">${klappe.name}</h4>
            ${Object.keys(klappe.categories).map(category => {
              const entities = klappe.categories[category];
              if (entities.length === 0) return html``;
              return html`
                <div class="check-category">
                  <h5 class="category-title">${category}</h5>
                  <div class="entity-checklist">
                    ${entities.map(entity => html`
                      <div class="checklist-item ${entity.exists ? 'item-valid' : 'item-invalid'}">
                        <span class="checklist-icon">
                          ${entity.exists ? html`
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>
                          ` : html`
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
                            </svg>
                          `}
                        </span>
                        <span class="checklist-label">${entity.label}</span>
                        <span class="checklist-entity">${entity.entityId}</span>
                      </div>
                    `)}
                  </div>
                </div>
              `;
            })}
            ${klappe.errors.length > 0 ? html`
              <div class="klappe-errors">
                <h5 class="errors-title">Fehler in ${klappe.name}:</h5>
                <ul class="errors-list">
                  ${klappe.errors.map(error => html`
                    <li class="error-item">
                      <strong>${error.field}:</strong> ${error.entityId}
                    </li>
                  `)}
                </ul>
              </div>
            ` : ''}
          </div>
        `)}
      </div>

      ${results.errors.length > 0 ? html`
        <div class="check-error-report">
          <h3>Fehlerbericht</h3>
          <div class="error-report-content">
            <p class="error-report-intro">Die folgenden Entities wurden nicht gefunden:</p>
            <ul class="error-report-list">
              ${results.errors.map(error => html`
                <li class="error-report-item">
                  <strong>${error.klappe}</strong> - ${error.field}: <code>${error.entityId}</code>
                </li>
              `)}
            </ul>
          </div>
        </div>
      ` : html`
        <div class="check-success">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <p>Alle konfigurierten Entities wurden erfolgreich gefunden!</p>
        </div>
      `}
    `;
  }

  render() {
    if (!this.settingsReady) {
      return html`
        <div class="container hkweb-settings-loading">
          <div class="glass-card" style="margin:2rem auto;max-width:420px;padding:1.5rem;text-align:center;">
            <p style="margin:0;font-size:1rem;color:var(--liq-text,#2a2e3a);">Einstellungen werden geladen…</p>
            <p style="margin:0.75rem 0 0;font-size:0.85rem;opacity:0.75;">Optional: hkweb-autosave.json</p>
          </div>
        </div>
      `;
    }
    const showOverlay = this.isMobile() && !this.sidebarCollapsed;
    const stripClass = this.sidebarCollapsed ? 'sidebar-strip-narrow' : 'sidebar-strip-wide';
    return html`
      <div class="container ${stripClass}">
        ${this.renderSidebar()}
        ${showOverlay 
          ? html`<div class="sidebar-overlay" @click=${() => this.toggleSidebar()}></div>`
          : ''}
        <div class="content">${this.renderContent()}</div>
        ${this.renderEntityCheckModal()}
      </div>
    `;
  }
}

customElements.define('hk-web-app', HKWebApp);

// Hinweis: Panel-Wrapper (hkweb-app / panel-hk-web-app) nur in der separaten HA-Frontend-Integration,
// nicht im Add-on – hier wird nur <hk-web-app> per addon-entry.mjs eingebunden.
