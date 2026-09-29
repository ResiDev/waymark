// What an app's bundler already declares; here only so the copies typecheck in this repo.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
