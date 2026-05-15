/**
 * Usuarios: localStorage es la fuente de verdad para altas, bajas logicas y cambios de plan.
 * data/users.json (fetch) solo aporta usuarios iniciales al combinar; el navegador no puede escribir ese archivo en disco.
 * Respaldo embebido: funciona con file://, sin servidor, sin red o si falla fetch.
 * Mantén alineado con data/users.json el bloque DEFAULT_SEED_JSON.
 */
(function (global) {
  var DB_KEY = "neuronest_users_db_v1";
  var LEGACY_EXTRA_KEY = "neuronest_extra_users_v1";
  var SEED_ELEMENT_ID = "neuronest-users-seed";

  /** Copia de respaldo (misma forma que data/users.json). Sincroniza al cambiar el JSON del repo. */
  var DEFAULT_SEED_JSON =
    '{"users":[{"id":1,"nombre":"admin","email":"admin@gmail.com","password":"123456","tipo_plan":"premium","rol":"usuario","estado":"activo","ciudad":""}]}';

  var USERS_JSON_URL = (function () {
    try {
      var cur = document.currentScript;
      if (cur && cur.src) {
        return new URL("../data/users.json", cur.src).href;
      }
    } catch (e) {}
    try {
      return new URL("data/users.json", global.location.href).href;
    } catch (e2) {
      return "data/users.json";
    }
  })();

  function getSeedUsers() {
    try {
      var el = document.getElementById(SEED_ELEMENT_ID);
      if (el && el.textContent && el.textContent.trim()) {
        var j = JSON.parse(el.textContent);
        if (Array.isArray(j.users) && j.users.length) {
          return j.users.slice();
        }
      }
    } catch (e) {}
    try {
      var j2 = JSON.parse(DEFAULT_SEED_JSON);
      return Array.isArray(j2.users) && j2.users.length ? j2.users.slice() : [];
    } catch (e2) {
      return [];
    }
  }

  function getDbUsers() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (!raw) {
        return null;
      }
      var j = JSON.parse(raw);
      return Array.isArray(j.users) ? j.users : null;
    } catch (e) {
      return null;
    }
  }

  function setDbUsers(users) {
    localStorage.setItem(DB_KEY, JSON.stringify({ users: users }));
  }

  function getLegacyExtras() {
    try {
      var raw = localStorage.getItem(LEGACY_EXTRA_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function clearLegacyExtras() {
    localStorage.removeItem(LEGACY_EXTRA_KEY);
  }

  function normalizeEmail(s) {
    return (s || "").trim().toLowerCase();
  }

  function mergeByEmail(base, additions) {
    var seen = {};
    var out = [];
    (base || []).forEach(function (u) {
      var k = normalizeEmail(u.email);
      if (!k) {
        return;
      }
      seen[k] = true;
      out.push(u);
    });
    (additions || []).forEach(function (u) {
      var k = normalizeEmail(u.email);
      if (!k || seen[k]) {
        return;
      }
      seen[k] = true;
      out.push(u);
    });
    return out;
  }

  function mergeRemoteIntoLocal(localUsers, remoteUsers) {
    var map = {};
    (localUsers || []).forEach(function (u) {
      var k = normalizeEmail(u.email);
      if (k) {
        map[k] = Object.assign({}, u);
      }
    });
    (remoteUsers || []).forEach(function (u) {
      var k = normalizeEmail(u.email);
      if (!k) {
        return;
      }
      if (map[k]) {
        map[k] = Object.assign({}, map[k], u);
      } else {
        map[k] = Object.assign({}, u);
      }
    });
    var out = [];
    Object.keys(map).forEach(function (k) {
      out.push(map[k]);
    });
    return out;
  }

  function fetchRemoteUsers() {
    var seed = getSeedUsers();
    if (!global.fetch) {
      return Promise.resolve(seed.slice());
    }
    return fetch(USERS_JSON_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          throw new Error("HTTP " + r.status);
        }
        return r.json();
      })
      .then(function (j) {
        var fromNet = Array.isArray(j.users) ? j.users : [];
        if (!fromNet.length && seed.length) {
          return seed.slice();
        }
        return fromNet;
      })
      .catch(function () {
        return seed.slice();
      });
  }

  function getAllUsers() {
    return fetchRemoteUsers()
      .then(function (remote) {
        var seed = getSeedUsers();
        if (!remote || !remote.length) {
          remote = seed.slice();
        }
        var local = getDbUsers();
        var legacy = getLegacyExtras();
        var merged;

        if (!local || local.length === 0) {
          merged = mergeByEmail(remote, legacy);
        } else {
          merged = mergeRemoteIntoLocal(local, remote);
          merged = mergeByEmail(merged, legacy);
        }

        if (!merged || !merged.length) {
          merged = seed.slice();
        }

        setDbUsers(merged);
        if (legacy.length) {
          clearLegacyExtras();
        }
        return merged;
      });
  }

  function nextUserId(allUsers) {
    var maxId = 0;
    (allUsers || []).forEach(function (u) {
      var id = Number(u && u.id);
      if (!isNaN(id) && id > maxId) {
        maxId = id;
      }
    });
    return maxId + 1;
  }

  function persistNewUser(newUser) {
    var all = getDbUsers() || [];
    all = all.slice();
    all.push(newUser);
    setDbUsers(all);
    return Promise.resolve();
  }

  function updateUserInPersistence(userId, patch) {
    var all = getDbUsers();
    if (!all || !all.length) {
      return Promise.resolve(false);
    }
    var id = Number(userId);
    var found = false;
    var next = all.map(function (u) {
      if (Number(u.id) === id) {
        found = true;
        return Object.assign({}, u, patch);
      }
      return u;
    });
    if (found) {
      setDbUsers(next);
    }
    return Promise.resolve(found);
  }

  /** Claves que no debe borrar el cierre de sesión (la BD de usuarios vive en localStorage). */
  var PRESERVE_ON_LOGOUT_KEYS = [DB_KEY, LEGACY_EXTRA_KEY, "neuronest_pro_bookings_v1"];

  global.NeuronestUsersJson = {
    getAllUsers: getAllUsers,
    persistNewUser: persistNewUser,
    updateUserInPersistence: updateUserInPersistence,
    nextUserId: nextUserId,
    normalizeEmail: normalizeEmail,
    fetchRemoteUsers: fetchRemoteUsers,
    getDbUsers: getDbUsers,
    usersJsonUrl: USERS_JSON_URL,
    getSeedUsers: getSeedUsers,
    preserveOnLogoutKeys: PRESERVE_ON_LOGOUT_KEYS,
  };
})(typeof window !== "undefined" ? window : this);
