# snapshot-app

Generated from the Cornerstone **standard preview** composition.

Support matrix: `standard-preview-node24-pg17` (supported preview; not certified for production).

The `production` and `regulated` profiles remain unavailable until their certification gates pass.

Security warning: values in `.env.example`, including fixed secrets and database credentials, are local-development fixtures only. Before production or any external deployment, replace them with independent secrets and credentials and pass validation with `NODE_ENV=production`.

`create-cornerstone verify` checks manifest resolution and composer-owned shared outputs. It does not require user-owned fragment source to remain byte-identical to the template or authenticate the entire project against tampering. Lock `integrity` is a self-consistency digest; release authenticity depends on package provenance and the M9 distribution-trust gate.
