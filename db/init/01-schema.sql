-- This SQL file runs once during the first initialization of the Docker volume.
-- Separate database object owner from the runtime role.
CREATE ROLE tenant_owner NOLOGIN;
CREATE ROLE app_user LOGIN PASSWORD 'local_app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE TABLE public.tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE public.user_tenants (
  user_id UUID NOT NULL REFERENCES public.users(id),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
    REFERENCES public.tenants(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100)
);

CREATE INDEX idx_projects_tenant_id_id ON public.projects(tenant_id, id);

ALTER TABLE public.tenants OWNER TO tenant_owner;
ALTER TABLE public.users OWNER TO tenant_owner;
ALTER TABLE public.user_tenants OWNER TO tenant_owner;
ALTER TABLE public.projects OWNER TO tenant_owner;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_isolation ON public.projects
  FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO app_user;
-- Application needs membership reads to authorize a selected tenant.
GRANT SELECT ON public.user_tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO app_user;
-- Never grant TRUNCATE to the runtime role: RLS does not apply to TRUNCATE.
