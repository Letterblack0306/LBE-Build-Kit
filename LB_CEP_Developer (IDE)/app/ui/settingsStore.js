export const settingsStore = {
  config: {
    provider: '',
    apiKey: '',
    endpoint: '',
    model: '',
    capability: 'chat',
    temperature: 0.7,
    preset: 'balanced',
    smartModelSelection: true,  // Agent picks best model per task type when ON
    modelSelectionGovernance: {
      sessionLockEnabled: true,
      requireCapabilityMatch: true,
      requireProviderAllowlist: true,
      fallbackPolicy: {
        providerOrder: ['openai', 'google', 'anthropic'],
        allowCrossProviderFallback: true,
        allowManualModelOverrideWhenSmartOff: true,
        maxAttempts: 5
      }
    },
  },
  profiles: [],

  async load() {
    if (window.ide?.loadSettings) {
      const data = await window.ide.loadSettings();
      if (data?.config) this.config = { ...this.config, ...data.config };
      if (Array.isArray(data?.profiles)) this.profiles = data.profiles;
      return;
    }
    const saved = localStorage.getItem('api_settings');
    if (saved) {
      try { this.config = { ...this.config, ...JSON.parse(saved) }; } catch (e) { }
    }
    this.profiles = this._loadProfiles();
  },

  async save(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (window.ide?.saveSettings) {
      await window.ide.saveSettings({ config: this.config, profiles: this.profiles });
      return;
    }
    localStorage.setItem('api_settings', JSON.stringify(this.config));
  },

  async saveProfile(name) {
    if (!name || !name.trim()) return;
    const profiles = this._loadProfiles();
    const idx = profiles.findIndex(p => p.name === name.trim());
    const profile = { name: name.trim(), ...this.config };
    if (idx >= 0) profiles[idx] = profile;
    else profiles.push(profile);
    this.profiles = profiles;
    if (window.ide?.saveSettings) {
      await window.ide.saveSettings({ config: this.config, profiles: this.profiles });
      return;
    }
    localStorage.setItem('api_profiles', JSON.stringify(profiles));
  },

  async loadProfile(name) {
    const profile = this._loadProfiles().find(p => p.name === name);
    if (!profile) return;
    const { name: _n, ...cfg } = profile;
    await this.save(cfg);
  },

  async deleteProfile(name) {
    const profiles = this._loadProfiles().filter(p => p.name !== name);
    this.profiles = profiles;
    if (window.ide?.saveSettings) {
      await window.ide.saveSettings({ config: this.config, profiles: this.profiles });
      return;
    }
    localStorage.setItem('api_profiles', JSON.stringify(profiles));
  },

  _loadProfiles() {
    if (window.ide?.loadSettings) return this.profiles || [];
    try { return JSON.parse(localStorage.getItem('api_profiles') || '[]'); } catch { return []; }
  }
};
