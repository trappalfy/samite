// @samite/formats: samite/job@1, samite/delivery@1 and rejection reasons (CLAUDE.md §5).
// Pure: no I/O, runs the same in Node and in browsers.
export { FormatError, type Issue } from "./errors"
export { FORMAT_LIMITS } from "./limits"
export {
  CATEGORIES,
  DELIVERABLE_KINDS,
  JOB_VERSION,
  jobSpecSchema,
  parseJobSpec,
  type Attachment,
  type Category,
  type Deliverable,
  type JobSpec,
  type JobSpecResult,
} from "./job"
export {
  DELIVERY_VERSION,
  deliverySchema,
  parseDelivery,
  type DeliveredFile,
  type Delivery,
  type DeliveryResult,
} from "./delivery"
export { parseRejectionReason, rejectionReasonSchema, type RejectionReasonResult } from "./reason"
export { jcs } from "./jcs"
export { canonicalBytes, canonicalJson, normalizeNfc } from "./canonical"
export { byteCount, charCount } from "./text"
export { deliveryHash, reasonHash, sha256, specHash, toHex, type Hashed } from "./hash"
export { AUTH_SCHEME, formatAuthorization, parseAuthorization, requestMessage, type Authorization, type RequestToSign } from "./request"
