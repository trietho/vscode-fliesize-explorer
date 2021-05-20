'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const fileExplorer_1 = require("./fileExplorer");
function activate(context) {
    new fileExplorer_1.FileExplorer(context);
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map