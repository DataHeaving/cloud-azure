import * as storage from "@azure/storage-blob";
import * as common from "@data-heaving/common";
import test, { ExecutionContext } from "ava";
import * as spec from "..";

test.before("Set up KV mock container", (t) => {});
// TODO: docker run --rm --entrypoint sh -p 10001:10001 -p 10000:10000 node:14-alpine3.13 -c 'apk update && apk add openssl && openssl req -newkey rsa:2048 -x509 -nodes -keyout key.pem -new -out cert.pem -sha256 -days 365 -addext "subjectAltName=IP:127.0.0.1" -subj "/C=CO/ST=ST/L=LO/O=OR/OU=OU/CN=CN" && npm install --global ms-vault-mock && ms-vault-mock --certificate cert.pem --private_key key.pem'
