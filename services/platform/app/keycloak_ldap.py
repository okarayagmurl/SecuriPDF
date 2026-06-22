from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import HTTPException


class KeycloakLdapApplier:
    """Admin panelinden kaydedilen LDAP ayarlarini Keycloak federation'a uygular."""

    GROUP_TO_ROLE: dict[str, str] = {
        "SecuriPDF-Users": "pdf-user",
        "SecuriPDF-Admins": "pdf-admin",
    }

    def __init__(
        self,
        base_url: str | None = None,
        admin_user: str | None = None,
        admin_password: str | None = None,
        realm: str | None = None,
    ):
        self.base_url = (base_url or os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")).rstrip("/")
        self.admin_user = admin_user or os.getenv("KEYCLOAK_ADMIN", "admin")
        self.admin_password = admin_password or os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
        self.realm = realm or os.getenv("KEYCLOAK_REALM", "securipdf")
        if not self.admin_password:
            raise HTTPException(status_code=503, detail="KEYCLOAK_ADMIN_PASSWORD tanimli degil")

    def _token(self, client: httpx.Client) -> str:
        resp = client.post(
            f"{self.base_url}/realms/master/protocol/openid-connect/token",
            data={
                "client_id": "admin-cli",
                "username": self.admin_user,
                "password": self.admin_password,
                "grant_type": "password",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Keycloak admin token alinamadi: {resp.text[:200]}")
        return resp.json()["access_token"]

    def _headers(self, token: str, json_body: bool = False) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {token}"}
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _ldap_federation_enabled(self, client: httpx.Client, token: str, enabled: bool) -> bool:
        """LDAP federation acik/kapali yapar; onceki durumu dondurur."""
        ldap = self._find_component(client, token, "entera-ad")
        if not ldap or not ldap.get("id"):
            return False
        config = dict(ldap.get("config") or {})
        was_enabled = config.get("enabled", ["true"]) != ["false"]
        desired = "true" if enabled else "false"
        if config.get("enabled", ["true"]) == [desired]:
            return was_enabled
        payload = {
            "name": ldap["name"],
            "providerId": ldap["providerId"],
            "providerType": ldap["providerType"],
            "parentId": ldap.get("parentId"),
            "config": {**config, "enabled": [desired]},
        }
        resp = client.put(
            f"{self.base_url}/admin/realms/{self.realm}/components/{ldap['id']}",
            json=payload,
            headers=self._headers(token, json_body=True),
        )
        if resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=502,
                detail=f"LDAP federation durumu degistirilemedi: {resp.text[:200]}",
            )
        return was_enabled

    def _find_component(self, client: httpx.Client, token: str, name: str, parent_id: str | None = None) -> dict | None:
        params: dict[str, str] = {"name": name}
        if parent_id:
            params["parent"] = parent_id
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/components",
            params=params,
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return None
        items = resp.json()
        return items[0] if items else None

    def _upsert_component(
        self,
        client: httpx.Client,
        token: str,
        payload: dict[str, Any],
        existing: dict | None,
    ) -> str:
        if existing and existing.get("id"):
            comp_id = existing["id"]
            resp = client.put(
                f"{self.base_url}/admin/realms/{self.realm}/components/{comp_id}",
                json=payload,
                headers=self._headers(token),
            )
            if resp.status_code not in (200, 204):
                raise HTTPException(status_code=502, detail=f"Keycloak guncelleme hatasi: {resp.text[:300]}")
            return comp_id
        resp = client.post(
            f"{self.base_url}/admin/realms/{self.realm}/components",
            json=payload,
            headers=self._headers(token),
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"Keycloak olusturma hatasi: {resp.text[:300]}")
        location = resp.headers.get("Location", "")
        if location:
            return location.rstrip("/").split("/")[-1]
        created = self._find_component(client, token, payload["name"], payload.get("parentId"))
        if not created:
            raise HTTPException(status_code=502, detail="Keycloak bilesen ID alinamadi")
        return created["id"]

    def apply(self, ldap: dict[str, Any], bind_password: str) -> dict[str, Any]:
        host = ldap.get("host") or os.getenv("LDAP_HOST", "192.168.6.10")
        base_dn = ldap.get("base_dn") or os.getenv("LDAP_BASE_DN", "dc=entera,dc=test")
        users_dn = ldap.get("users_dn") or os.getenv("LDAP_USERS_DN") or f"CN=Users,{base_dn}"
        groups_dn = ldap.get("groups_dn") or os.getenv("LDAP_GROUPS_DN") or base_dn
        bind_dn = ldap.get("bind_dn") or os.getenv("LDAP_BIND_DN") or f"CN=svc-securipdf,{users_dn}"
        group_filter = ldap.get("group_filter") or "(cn=SecuriPDF-*)"
        groups = ldap.get("groups") or {}
        group_user = groups.get("user") or "SecuriPDF-Users"
        group_admin = groups.get("admin") or "SecuriPDF-Admins"

        if not bind_password:
            raise HTTPException(status_code=400, detail="LDAP bind parolasi tanimli degil")

        with httpx.Client(timeout=60.0) as client:
            token = self._token(client)
            realm_resp = client.get(
                f"{self.base_url}/admin/realms/{self.realm}",
                headers=self._headers(token),
            )
            if realm_resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Keycloak realm bulunamadi")
            realm_id = realm_resp.json()["id"]

            ldap_payload = {
                "name": "entera-ad",
                "providerId": "ldap",
                "providerType": "org.keycloak.storage.UserStorageProvider",
                "parentId": realm_id,
                "config": {
                    "enabled": ["true"],
                    "priority": ["0"],
                    "editMode": ["READ_ONLY"],
                    "syncRegistrations": ["false"],
                    "vendor": ["ad"],
                    "usernameLDAPAttribute": ["sAMAccountName"],
                    "rdnLDAPAttribute": ["cn"],
                    "uuidLDAPAttribute": ["objectGUID"],
                    "userObjectClasses": ["person, organizationalPerson, user"],
                    "connectionUrl": [f"ldap://{host}:389"],
                    "usersDn": [users_dn],
                    "bindDn": [bind_dn],
                    "bindCredential": [bind_password],
                    "searchScope": ["2"],
                    "referral": ["ignore"],
                    "pagination": ["false"],
                    "importEnabled": ["true"],
                    "connectionPooling": ["true"],
                    "useTruststoreSpi": ["ldapsOnly"],
                },
            }
            existing_ldap = self._find_component(client, token, "entera-ad")
            ldap_id = self._upsert_component(client, token, ldap_payload, existing_ldap)

            group_mapper = {
                "name": "ad-groups",
                "providerId": "group-ldap-mapper",
                "providerType": "org.keycloak.storage.ldap.mappers.LDAPStorageMapper",
                "parentId": ldap_id,
                "config": {
                    "groups.dn": [groups_dn],
                    "group.name.ldap.attribute": ["cn"],
                    "group.object.classes": ["group"],
                    "membership.ldap.attribute": ["member"],
                    "membership.attribute.type": ["DN"],
                    "groups.ldap.filter": [group_filter],
                    "mode": ["READ_ONLY"],
                    "preserve.group.inheritance": ["false"],
                    "ignore.missing.groups": ["true"],
                    "user.roles.retrieve.strategy": ["LOAD_GROUPS_BY_MEMBER_ATTRIBUTE"],
                },
            }
            existing_gm = self._find_component(client, token, "ad-groups", ldap_id)
            self._upsert_component(client, token, group_mapper, existing_gm)

            for name, ad_group, role in (
                ("ad-role-pdf-user", group_user, "pdf-user"),
                ("ad-role-pdf-admin", group_admin, "pdf-admin"),
            ):
                role_mapper = {
                    "name": name,
                    "providerId": "role-ldap-mapper",
                    "providerType": "org.keycloak.storage.ldap.mappers.LDAPStorageMapper",
                    "parentId": ldap_id,
                    "config": {
                        "roles.dn": [groups_dn],
                        "role.name.ldap.attribute": ["cn"],
                        "role.object.classes": ["group"],
                        "membership.ldap.attribute": ["member"],
                        "membership.attribute.type": ["DN"],
                        "roles.ldap.filter": [f"(cn={ad_group})"],
                        "mode": ["READ_ONLY"],
                        "use.realm.roles.mapping": ["true"],
                        "roles.realm.role.mapping": [f"{ad_group}={role}"],
                    },
                }
                existing_rm = self._find_component(client, token, name, ldap_id)
                self._upsert_component(client, token, role_mapper, existing_rm)

            sync_resp = client.post(
                f"{self.base_url}/admin/realms/{self.realm}/user-storage/{ldap_id}/sync",
                params={"action": "triggerFullSync"},
                headers=self._headers(token),
            )
            sync_ok = sync_resp.status_code in (200, 204)

            return {
                "ok": True,
                "ldapId": ldap_id,
                "connectionUrl": f"ldap://{host}:389",
                "groupsDn": groups_dn,
                "usersDn": users_dn,
                "syncTriggered": sync_ok,
                "message": "LDAP federation Keycloak'a uygulandi",
            }

    def _ldap_provider(self, client: httpx.Client, token: str) -> dict[str, Any]:
        ldap = self._find_component(client, token, "entera-ad")
        if not ldap or not ldap.get("id"):
            raise HTTPException(
                status_code=404,
                detail="LDAP federation (entera-ad) bulunamadi — once Keycloak'a uygulayin",
            )
        return ldap

    def _ad_group_names(self) -> tuple[str, str]:
        return (
            os.getenv("LDAP_GROUP_USER", "SecuriPDF-Users"),
            os.getenv("LDAP_GROUP_ADMIN", "SecuriPDF-Admins"),
        )

    def _find_group_id(self, client: httpx.Client, token: str, group_name: str) -> str | None:
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/groups",
            params={"search": group_name, "max": "20"},
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return None
        for group in resp.json():
            if group.get("name") == group_name:
                return group.get("id")
        return None

    def _group_member_roles_index(
        self,
        client: httpx.Client,
        token: str,
        group_names: list[str],
    ) -> dict[str, set[str]]:
        index: dict[str, set[str]] = {}
        for group_name in group_names:
            role = self.GROUP_TO_ROLE.get(group_name)
            if not role:
                continue
            group_id = self._find_group_id(client, token, group_name)
            if not group_id:
                continue
            first = 0
            page_size = 500
            while True:
                resp = client.get(
                    f"{self.base_url}/admin/realms/{self.realm}/groups/{group_id}/members",
                    params={"first": str(first), "max": str(page_size)},
                    headers=self._headers(token),
                )
                if resp.status_code != 200:
                    break
                members = resp.json()
                if not members:
                    break
                for member in members:
                    user_id = member.get("id")
                    if user_id:
                        index.setdefault(user_id, set()).add(role)
                if len(members) < page_size:
                    break
                first += page_size
        return index

    def _ensure_group_role_mappings(self, client: httpx.Client, token: str) -> dict[str, bool]:
        mapped: dict[str, bool] = {}
        for group_name, role_name in self.GROUP_TO_ROLE.items():
            group_id = self._find_group_id(client, token, group_name)
            if not group_id:
                mapped[f"{group_name}->{role_name}"] = False
                continue
            role_resp = client.get(
                f"{self.base_url}/admin/realms/{self.realm}/roles/{role_name}",
                headers=self._headers(token),
            )
            if role_resp.status_code != 200:
                mapped[f"{group_name}->{role_name}"] = False
                continue
            role = role_resp.json()
            map_resp = client.post(
                f"{self.base_url}/admin/realms/{self.realm}/groups/{group_id}/role-mappings/realm",
                json=[{"id": role["id"], "name": role_name}],
                headers=self._headers(token, json_body=True),
            )
            mapped[f"{group_name}->{role_name}"] = map_resp.status_code in (200, 204, 409)
        return mapped

    @staticmethod
    def _resolve_user_status(
        username: str | None,
        enabled: bool,
        active_sessions: int,
        login_errors: set[str],
    ) -> tuple[str, str]:
        """statusKind: session | login_error | idle | disabled"""
        if active_sessions > 0:
            label = "Oturum acik" if active_sessions == 1 else f"Oturum acik ({active_sessions})"
            return "session", label
        uname = (username or "").strip().lower()
        if uname and uname in login_errors:
            return "login_error", "Giris hatasi"
        if not enabled:
            return "disabled", "Devre disi"
        return "idle", "Giris yok"

    def _ensure_realm_events(self, client: httpx.Client, token: str) -> None:
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}",
            headers=self._headers(token),
        )
        if resp.status_code != 200 or resp.json().get("eventsEnabled"):
            return
        client.put(
            f"{self.base_url}/admin/realms/{self.realm}",
            json={
                "eventsEnabled": True,
                "eventsExpiration": 604800,
                "enabledEventTypes": ["LOGIN", "LOGIN_ERROR", "LOGOUT"],
            },
            headers=self._headers(token, json_body=True),
        )

    def _recent_login_error_usernames(self, client: httpx.Client, token: str) -> set[str]:
        self._ensure_realm_events(client, token)
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/events",
            params={"type": "LOGIN_ERROR", "max": "200"},
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return set()

        cutoff_ms = int(time.time() * 1000) - (24 * 60 * 60 * 1000)
        errors: set[str] = set()
        for event in resp.json():
            if event.get("time", 0) < cutoff_ms:
                continue
            details = event.get("details") or {}
            for key in ("username", "auth_username", "attempted_username"):
                value = details.get(key)
                if value:
                    errors.add(str(value).strip().lower())
        return errors

    def _user_session_count(self, client: httpx.Client, token: str, user_id: str) -> int:
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/users/{user_id}/sessions",
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return 0
        return len(resp.json())

    def _merge_roles(self, direct_roles: list[str], group_roles: set[str]) -> list[str]:
        return self._visible_roles(list(set(direct_roles) | group_roles))

    @staticmethod
    def _visible_roles(role_names: list[str]) -> list[str]:
        skip = {"offline_access", "uma_authorization"}
        visible: list[str] = []
        for name in role_names:
            if name in skip or name.startswith("default-roles-"):
                continue
            visible.append(name)
        return sorted(visible)

    def sync_ldap(self, sync_users: bool = True, sync_groups: bool = True) -> dict[str, Any]:
        with httpx.Client(timeout=120.0) as client:
            token = self._token(client)
            ldap = self._ldap_provider(client, token)
            ldap_id = ldap["id"]
            result: dict[str, Any] = {"ok": True, "ldapId": ldap_id}

            if sync_users:
                resp = client.post(
                    f"{self.base_url}/admin/realms/{self.realm}/user-storage/{ldap_id}/sync",
                    params={"action": "triggerFullSync"},
                    headers=self._headers(token),
                )
                if resp.status_code not in (200, 201, 204):
                    raise HTTPException(
                        status_code=502,
                        detail=f"Kullanici senkronu basarisiz: {resp.text[:300]}",
                    )
                result["usersSync"] = True
                if resp.content:
                    try:
                        result["usersSyncDetail"] = resp.json()
                    except Exception:
                        pass

            if sync_groups:
                group_mapper = self._find_component(client, token, "ad-groups", ldap_id)
                if not group_mapper:
                    result["groupsSync"] = False
                    result["groupsSyncMessage"] = "ad-groups mapper bulunamadi"
                else:
                    resp = client.post(
                        f"{self.base_url}/admin/realms/{self.realm}/user-storage/{ldap_id}/mappers/{group_mapper['id']}/sync",
                        params={"direction": "fedToKeycloak"},
                        headers=self._headers(token),
                    )
                    result["groupsSync"] = resp.status_code in (200, 201, 204)

                mapper_resp = client.get(
                    f"{self.base_url}/admin/realms/{self.realm}/components",
                    params={"parent": ldap_id},
                    headers=self._headers(token),
                )
                role_sync: dict[str, Any] = {}
                if mapper_resp.status_code == 200:
                    for mapper in mapper_resp.json():
                        if mapper.get("providerId") != "role-ldap-mapper":
                            continue
                        name = mapper.get("name", mapper.get("id", ""))
                        sync_resp = client.post(
                            f"{self.base_url}/admin/realms/{self.realm}/user-storage/{ldap_id}/mappers/{mapper['id']}/sync",
                            params={"direction": "fedToKeycloak"},
                            headers=self._headers(token),
                        )
                        role_sync[name] = sync_resp.status_code in (200, 201, 204)
                result["roleMappersSync"] = role_sync
                result["groupRoleMappings"] = self._ensure_group_role_mappings(client, token)

            result["message"] = "LDAP senkron tamamlandi"
            return result

    def _user_realm_roles(self, client: httpx.Client, token: str, user_id: str) -> list[str]:
        resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/users/{user_id}/role-mappings/realm",
            headers=self._headers(token),
        )
        if resp.status_code != 200:
            return []
        return [item.get("name", "") for item in resp.json() if item.get("name")]

    def _fetch_users_page(
        self,
        client: httpx.Client,
        token: str,
        search: str | None,
        first: int,
        size: int,
    ) -> tuple[int, httpx.Response]:
        count_params: dict[str, str] = {}
        list_params: dict[str, str] = {
            "first": str(first),
            "max": str(size),
            "briefRepresentation": "true",
        }
        if search:
            count_params["search"] = search
            list_params["search"] = search

        headers = self._headers(token)
        count_resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/users/count",
            params=count_params,
            headers=headers,
        )
        total = int(count_resp.text) if count_resp.status_code == 200 else 0
        users_resp = client.get(
            f"{self.base_url}/admin/realms/{self.realm}/users",
            params=list_params,
            headers=headers,
        )
        return total, users_resp

    @staticmethod
    def _needs_cache_fallback(users_resp: httpx.Response) -> bool:
        if users_resp.status_code == 200:
            return False
        return "Cannot parse the JSON" in users_resp.text

    def list_users(
        self,
        search: str | None = None,
        page: int = 1,
        size: int = 50,
        federated_only: bool = False,
    ) -> dict[str, Any]:
        page = max(1, page)
        size = max(1, min(size, 100))
        first = (page - 1) * size
        list_source = "keycloak"

        with httpx.Client(timeout=120.0) as client:
            token = self._token(client)
            ldap_was_enabled = False
            ldap_paused = False

            def pause_ldap() -> None:
                nonlocal ldap_was_enabled, ldap_paused
                if ldap_paused:
                    return
                ldap_was_enabled = self._ldap_federation_enabled(client, token, enabled=False)
                ldap_paused = ldap_was_enabled

            def restore_ldap() -> None:
                nonlocal ldap_paused
                if ldap_paused and ldap_was_enabled:
                    self._ldap_federation_enabled(client, token, enabled=True)
                ldap_paused = False

            try:
                total, users_resp = self._fetch_users_page(client, token, search, first, size)

                if self._needs_cache_fallback(users_resp):
                    pause_ldap()
                    total, users_resp = self._fetch_users_page(client, token, search, first, size)
                    list_source = "cache"

                if users_resp.status_code != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Kullanici listesi alinamadi: {users_resp.text[:300]}",
                    )

                raw_users = users_resp.json()
                group_user, group_admin = self._ad_group_names()
                group_roles_index = self._group_member_roles_index(
                    client, token, [group_user, group_admin]
                )

                if any(bool(u.get("federationLink")) for u in raw_users):
                    pause_ldap()

                login_errors = self._recent_login_error_usernames(client, token)

                items: list[dict[str, Any]] = []
                for raw in raw_users:
                    federated = bool(raw.get("federationLink"))
                    if federated_only and not federated:
                        continue
                    user_id = raw["id"]
                    username = raw.get("username")
                    direct_roles = self._user_realm_roles(client, token, user_id)
                    group_roles = group_roles_index.get(user_id, set())
                    sessions = self._user_session_count(client, token, user_id)
                    status_kind, status_label = self._resolve_user_status(
                        username, raw.get("enabled", False), sessions, login_errors
                    )
                    items.append(
                        {
                            "id": user_id,
                            "username": username,
                            "email": raw.get("email"),
                            "firstName": raw.get("firstName"),
                            "lastName": raw.get("lastName"),
                            "enabled": raw.get("enabled", False),
                            "federated": federated,
                            "source": "AD" if federated else "Keycloak",
                            "roles": self._merge_roles(direct_roles, group_roles),
                            "activeSessions": sessions,
                            "statusKind": status_kind,
                            "statusLabel": status_label,
                        }
                    )

                if federated_only:
                    total = len(items)

                return {
                    "items": items,
                    "page": page,
                    "size": size,
                    "total": total,
                    "search": search or "",
                    "federatedOnly": federated_only,
                    "listSource": list_source,
                }
            finally:
                restore_ldap()

    def create_local_user(
        self,
        username: str,
        password: str,
        email: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        roles: list[str] | None = None,
    ) -> dict[str, Any]:
        username = username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="Kullanici adi zorunlu")
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="Parola en az 8 karakter olmali")

        allowed_roles = {"pdf-user", "pdf-admin"}
        assign_roles = [r for r in (roles or ["pdf-user"]) if r in allowed_roles]
        if not assign_roles:
            assign_roles = ["pdf-user"]

        payload: dict[str, Any] = {
            "username": username,
            "enabled": True,
            "emailVerified": True,
            "credentials": [{"type": "password", "value": password, "temporary": False}],
        }
        if email:
            payload["email"] = email
        if first_name:
            payload["firstName"] = first_name
        if last_name:
            payload["lastName"] = last_name

        with httpx.Client(timeout=60.0) as client:
            token = self._token(client)
            resp = client.post(
                f"{self.base_url}/admin/realms/{self.realm}/users",
                json=payload,
                headers=self._headers(token, json_body=True),
            )
            if resp.status_code == 409:
                raise HTTPException(status_code=409, detail="Kullanici adi zaten mevcut")
            if resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail=f"Keycloak kullanici olusturulamadi: {resp.text[:300]}",
                )

            user_id = ""
            location = resp.headers.get("Location", "")
            if location:
                user_id = location.rstrip("/").split("/")[-1]
            if not user_id:
                found = client.get(
                    f"{self.base_url}/admin/realms/{self.realm}/users",
                    params={"username": username, "exact": "true"},
                    headers=self._headers(token),
                )
                if found.status_code == 200 and found.json():
                    user_id = found.json()[0]["id"]

            role_payload = []
            for role_name in assign_roles:
                role_resp = client.get(
                    f"{self.base_url}/admin/realms/{self.realm}/roles/{role_name}",
                    headers=self._headers(token),
                )
                if role_resp.status_code == 200:
                    role_payload.append({"id": role_resp.json()["id"], "name": role_name})

            if user_id and role_payload:
                client.post(
                    f"{self.base_url}/admin/realms/{self.realm}/users/{user_id}/role-mappings/realm",
                    json=role_payload,
                    headers=self._headers(token, json_body=True),
                )

            return {
                "ok": True,
                "id": user_id,
                "username": username,
                "roles": assign_roles,
                "source": "Keycloak",
                "message": "Yerel kullanici olusturuldu",
            }
