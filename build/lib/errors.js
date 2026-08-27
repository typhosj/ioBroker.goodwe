"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMessage = errorMessage;
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
