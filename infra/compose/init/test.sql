CREATE ROLE cornerstone_test_migrator LOGIN PASSWORD 'cornerstone-test-migrator';
CREATE ROLE cornerstone_test_app LOGIN PASSWORD 'cornerstone-test-app';
CREATE ROLE cornerstone_runtime NOLOGIN;
GRANT cornerstone_runtime TO cornerstone_test_app;

ALTER SCHEMA public OWNER TO cornerstone_test_migrator;
GRANT CONNECT ON DATABASE cornerstone_test TO cornerstone_test_app;
GRANT USAGE ON SCHEMA public TO cornerstone_test_app;
