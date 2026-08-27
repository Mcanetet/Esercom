/** Auth aislado — portal entrenamiento Angel IA (no usa sesión normal) */
window.AngelTrainAuth = {
  getToken() {
    return localStorage.getItem('angel_train_token');
  },
  getEmpresa() {
    return localStorage.getItem('angel_train_empresa');
  },
  getEmpresaNombre() {
    return localStorage.getItem('angel_train_empresa_nombre') || this.getEmpresa();
  },
  logout() {
    localStorage.removeItem('angel_train_token');
    localStorage.removeItem('angel_train_empresa');
    localStorage.removeItem('angel_train_empresa_nombre');
    window.location.replace('/acceso-angel.html');
  },
  require() {
    if (!this.getToken()) {
      window.location.replace('/acceso-angel.html');
      return false;
    }
    return true;
  },
  async api(path, options = {}) {
    const token = this.getToken();
    if (!token) {
      this.logout();
      throw new Error('Sesión de entrenamiento expirada');
    }
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'X-Angel-Train-Token': token,
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      this.logout();
      throw new Error('Sesión de entrenamiento expirada');
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Error en la solicitud');
    }
    return data;
  }
};
