CREATE ROLE cornerstone_dev_migrator LOGIN PASSWORD 'cornerstone-dev-migrator';
CREATE ROLE cornerstone_dev_app LOGIN PASSWORD 'cornerstone-dev-app';
CREATE ROLE cornerstone_dev_maintenance LOGIN PASSWORD 'cornerstone-dev-maintenance';
CREATE ROLE cornerstone_dev_admin_bootstrap LOGIN PASSWORD 'cornerstone-dev-admin-bootstrap';
CREATE ROLE cornerstone_runtime NOLOGIN;
CREATE ROLE cornerstone_maintenance NOLOGIN;
CREATE ROLE cornerstone_admin_bootstrap NOLOGIN;
GRANT cornerstone_runtime TO cornerstone_dev_app;
GRANT cornerstone_maintenance TO cornerstone_dev_maintenance;
GRANT cornerstone_admin_bootstrap TO cornerstone_dev_admin_bootstrap;

ALTER SCHEMA public OWNER TO cornerstone_dev_migrator;
GRANT CONNECT ON DATABASE cornerstone_dev TO cornerstone_dev_app;
GRANT CONNECT ON DATABASE cornerstone_dev TO cornerstone_dev_maintenance;
GRANT CONNECT ON DATABASE cornerstone_dev TO cornerstone_dev_admin_bootstrap;
GRANT USAGE ON SCHEMA public TO cornerstone_dev_app;
GRANT USAGE ON SCHEMA public TO cornerstone_dev_maintenance;
GRANT USAGE ON SCHEMA public TO cornerstone_dev_admin_bootstrap;
