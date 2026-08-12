CREATE ROLE cornerstone_test_migrator LOGIN PASSWORD 'cornerstone-test-migrator';
CREATE ROLE cornerstone_test_app LOGIN PASSWORD 'cornerstone-test-app';
CREATE ROLE cornerstone_test_maintenance LOGIN PASSWORD 'cornerstone-test-maintenance';
CREATE ROLE cornerstone_test_admin_bootstrap LOGIN PASSWORD 'cornerstone-test-admin-bootstrap';
CREATE ROLE cornerstone_runtime NOLOGIN;
CREATE ROLE cornerstone_maintenance NOLOGIN;
CREATE ROLE cornerstone_admin_bootstrap NOLOGIN;
GRANT cornerstone_runtime TO cornerstone_test_app;
GRANT cornerstone_maintenance TO cornerstone_test_maintenance;
GRANT cornerstone_admin_bootstrap TO cornerstone_test_admin_bootstrap;

ALTER SCHEMA public OWNER TO cornerstone_test_migrator;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_app;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_maintenance;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_admin_bootstrap;
GRANT USAGE ON SCHEMA public TO cornerstone_test_app;
GRANT USAGE ON SCHEMA public TO cornerstone_test_maintenance;
GRANT USAGE ON SCHEMA public TO cornerstone_test_admin_bootstrap;
