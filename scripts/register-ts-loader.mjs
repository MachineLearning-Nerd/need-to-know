// Node 24 deprecates --loader; this shim registers the same resolve hook via
// --import, which is the supported replacement and emits no warning.
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
