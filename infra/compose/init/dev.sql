CREATE ROLE cornerstone_dev_migrator LOGIN PASSWORD 'cornerstone-dev-migrator';
CREATE ROLE cornerstone_dev_app LOGIN PASSWORD 'cornerstone-dev-app';
CREATE ROLE cornerstone_dev_maintenance LOGIN PASSWORD 'cornerstone-dev-maintenance';
CREATE ROLE cornerstone_runtime NOLOGIN;
CREATE ROLE cornerstone_maintenance NOLOGIN;
GRANT cornerstone_runtime TO cornerstone_dev_app;
GRANT cornerstone_maintenance TO cornerstone_dev_maintenance;

ALTER SCHEMA public OWNER TO cornerstone_dev_migrator;
GRANT CONNECT ON DATABASE cornerstone_dev TO cornerstone_dev_app;
GRANT CONNECT ON DATABASE cornerstone_dev TO cornerstone_dev_maintenance;
GRANT USAGE ON SCHEMA public TO cornerstone_dev_app;
GRANT USAGE ON SCHEMA public TO cornerstone_dev_maintenance;
