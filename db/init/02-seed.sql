-- Fixed identifiers make the cross-tenant tests deterministic.
INSERT INTO public.tenants (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ABC Technologies'),
  ('22222222-2222-4222-8222-222222222222', 'XYZ Solutions');

INSERT INTO public.users (id, email) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'charlie@example.test');

INSERT INTO public.user_tenants (user_id, tenant_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222');

-- Docker initializes these as postgres (admin); never use admin DB credentials in the API.
INSERT INTO public.projects (id, tenant_id, name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ABC Website'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'XYZ Dashboard');
