CREATE ROLE cornerstone_test_migrator LOGIN PASSWORD 'cornerstone-test-migrator';
CREATE ROLE cornerstone_test_app LOGIN PASSWORD 'cornerstone-test-app';
CREATE ROLE cornerstone_test_maintenance LOGIN PASSWORD 'cornerstone-test-maintenance';
CREATE ROLE cornerstone_runtime NOLOGIN;
CREATE ROLE cornerstone_maintenance NOLOGIN;
GRANT cornerstone_runtime TO cornerstone_test_app;
GRANT cornerstone_maintenance TO cornerstone_test_maintenance;

ALTER SCHEMA public OWNER TO cornerstone_test_migrator;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_app;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_maintenance;
GRANT USAGE ON SCHEMA public TO cornerstone_test_app;
GRANT USAGE ON SCHEMA public TO cornerstone_test_maintenance;
