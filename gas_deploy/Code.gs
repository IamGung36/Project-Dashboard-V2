/**
 * Google Apps Script Web App Controller - Version 5
 * Multi-user Safe: Row-level mutations with optimistic locking,
 * Google Drive image uploads, server-side code generation, and automated backups.
 */

var SCHEMA = {
  projects: ['id', 'code', 'name', 'region', 'engineer', 'businessType', 'investor', 'client', 'systems', 'capacity', 'lat', 'lng', 'googleMapsLink', 'image', 'deliverables', 'notes', 'status', 'stage', 'deadline', 'constructionDate', 'codDate', 'prTest', 'pv', 'inverter', 'awardNote', 'revisions', 'updatedAt', 'mapDrawings'],
  awardedProjects: ['id', 'code', 'name', 'region', 'engineer', 'businessType', 'investor', 'client', 'systems', 'capacity', 'lat', 'lng', 'googleMapsLink', 'image', 'deliverables', 'notes', 'status', 'stage', 'deadline', 'constructionDate', 'codDate', 'prTest', 'pv', 'inverter', 'awardNote', 'revisions', 'updatedAt', 'mapDrawings'],
  members: ['id', 'name', 'role', 'updatedAt'],
  holidays: ['id', 'date', 'name', 'updatedAt'],
  manhours: ['id', 'memberId', 'date', 'hours', 'projectId', 'deliverableName', 'updatedAt'],
  calendarNotes: ['id', 'date', 'note', 'updatedAt']
};

var DEFAULT_SPREADSHEET_ID = '1i1xCILbxr0x3H8Mh0HOdCCJWvc1xQ-PdDXsvDaPaOH0';
var DRIVE_IMAGE_FOLDER_NAME = 'Project Dashboard Images';

/**
 * HTTP GET handler
 */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'get') {
    var dbJson = getDatabaseJson();
    return ContentService.createTextOutput(dbJson)
                         .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Project Dashboard - IamGung')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTTP POST handler
 */
function doPost(e) {
  var action = e && e.parameter && e.parameter.action;
  var response = {};
  try {
    var payloadStr = e && e.postData && e.postData.contents;
    
    if (action === 'mutate' && payloadStr) {
      response = handleMutate(payloadStr);
    } else if (action === 'uploadImage' && payloadStr) {
      response = handleUploadImage(payloadStr);
    } else if (action === 'replaceAll' && payloadStr) {
      response = handleReplaceAll(payloadStr);
    } else if (action === 'save') {
      response = {
        status: 'error',
        message: 'API เวอร์ชันเก่าถูกยกเลิกแล้วเพื่อป้องกันข้อมูลทับกัน กรุณารีเฟรชหน้าเว็บเพื่อใช้เวอร์ชันใหม่'
      };
    } else if (action === 'get') {
      var dbJson = getDatabaseJson();
      return ContentService.createTextOutput(dbJson)
                           .setMimeType(ContentService.MimeType.JSON);
    } else {
      response = { status: 'error', message: 'Invalid action or empty payload' };
    }
  } catch (err) {
    Logger.log('Error in doPost: ' + err.toString());
    response = { status: 'error', message: err.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
                       .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper to include HTML sub-templates
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

/**
 * Retrieve Spreadsheet reference
 */
function getSpreadsheet() {
  try {
    return SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  } catch (e) {
    Logger.log('Error opening spreadsheet by default ID: ' + e.toString());
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}

  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('SPREADSHEET_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {}
  }

  throw new Error('Could not open spreadsheet. Please check spreadsheet ID and sharing permissions.');
}

/**
 * Retrieve or create Google Drive folder for project images
 */
function getOrCreateImageFolder() {
  var folders = DriveApp.getFoldersByName(DRIVE_IMAGE_FOLDER_NAME);
  if (folders.hasNext()) {
    var folder = folders.next();
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}
    return folder;
  }
  var newFolder = DriveApp.createFolder(DRIVE_IMAGE_FOLDER_NAME);
  try {
    newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return newFolder;
}

/**
 * Trash an existing Drive file given its URL
 */
function trashDriveFileByUrl(url) {
  if (!url || typeof url !== 'string') return;
  var fileId = null;
  var m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1 && m1[1]) fileId = m1[1];
  var m2 = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (m2 && m2[1]) fileId = m2[1];

  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (err) {
      Logger.log('Could not trash file ' + fileId + ': ' + err);
    }
  }
}

/**
 * Handle Image Upload to Google Drive
 */
function handleUploadImage(payloadStr) {
  var payload = JSON.parse(payloadStr);
  var base64Str = payload.base64;
  var fileName = payload.fileName || ('proj_img_' + Date.now() + '.jpg');
  var oldImageUrl = payload.oldImageUrl || '';

  if (!base64Str) {
    return { status: 'error', message: 'No base64 data provided' };
  }

  var folder = getOrCreateImageFolder();
  var contentType = 'image/jpeg';
  var data = base64Str;
  if (base64Str.indexOf('base64,') > -1) {
    var parts = base64Str.split('base64,');
    contentType = parts[0].replace('data:', '').replace(';', '') || 'image/jpeg';
    data = parts[1];
  }

  var decoded = Utilities.base64Decode(data);
  var blob = Utilities.newBlob(decoded, contentType, fileName);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}

  var fileId = file.getId();
  // Using direct web view URL for maximum compatibility
  var url = 'https://lh3.googleusercontent.com/d/' + fileId;

  if (oldImageUrl) {
    trashDriveFileByUrl(oldImageUrl);
  }

  return { status: 'ok', url: url, fileId: fileId };
}

/**
 * Helper: Convert a Sheet to an array of objects
 */
function sheetToObjects(sheet, headers) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];
  
  var actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var objects = [];
  
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    var hasData = false;
    for (var c = 0; c < actualHeaders.length; c++) {
      var key = actualHeaders[c];
      if (!key) continue;
      var val = row[c];
      if (val !== '' && val !== null && val !== undefined) {
        hasData = true;
      }
      if ((key === 'systems' || key === 'deliverables' || key === 'revisions' || key === 'mapDrawings') && typeof val === 'string' && val.trim() !== '') {
        try {
          obj[key] = JSON.parse(val);
        } catch (e) {
          obj[key] = val;
        }
      } else if (val instanceof Date) {
        obj[key] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        obj[key] = val;
      }
    }
    if (hasData && obj.id) {
      objects.push(obj);
    }
  }
  return objects;
}

/**
 * Helper: Write array of objects to sheet (used for migrations and full restore)
 */
function objectsToSheet(sheet, objects, headers) {
  sheet.clear();
  sheet.appendRow(headers);
  try { sheet.setFrozenRows(1); } catch (e) {}
  if (!objects || objects.length === 0) return;

  var rows = [];
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = obj[key];
      if (val === undefined || val === null) {
        row.push('');
      } else if (typeof val === 'object') {
        row.push(JSON.stringify(val));
      } else {
        row.push(val);
      }
    }
    rows.push(row);
  }
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Generate next project code G26-XXX server-side under lock
 */
function generateNextProjectCode(ss) {
  var yearPrefix = 'G26-';
  var allProjects = [];
  var pSheet = ss.getSheetByName('projects');
  if (pSheet) allProjects = allProjects.concat(sheetToObjects(pSheet, SCHEMA.projects));
  var aSheet = ss.getSheetByName('awardedProjects');
  if (aSheet) allProjects = allProjects.concat(sheetToObjects(aSheet, SCHEMA.awardedProjects));

  var maxNum = 0;
  for (var i = 0; i < allProjects.length; i++) {
    var code = allProjects[i].code;
    if (code && typeof code === 'string' && code.indexOf(yearPrefix) === 0) {
      var numPart = code.split('-')[1];
      if (numPart) {
        var val = parseInt(numPart, 10);
        if (!isNaN(val) && val > maxNum) {
          maxNum = val;
        }
      }
    }
  }
  return yearPrefix + ('000' + (maxNum + 1)).slice(-3);
}

/**
 * Ensure sheet exists and has proper headers
 */
function getOrCreateSheetWithHeaders(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  var headers = SCHEMA[sheetName] || [];
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    try { sheet.setFrozenRows(1); } catch (e) {}
    return sheet;
  }
  
  // Verify headers
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(headers);
    try { sheet.setFrozenRows(1); } catch (e) {}
  } else {
    var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (existingHeaders.indexOf(headers[i]) === -1) {
        var nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol).setValue(headers[i]);
      }
    }
  }
  return sheet;
}

/**
 * Convert a single object to row array according to headers
 */
function objectToRowValues(obj, headers) {
  var row = [];
  for (var j = 0; j < headers.length; j++) {
    var key = headers[j];
    var val = obj[key];
    if (val === undefined || val === null) {
      row.push('');
    } else if (typeof val === 'object') {
      row.push(JSON.stringify(val));
    } else {
      row.push(val);
    }
  }
  return row;
}

/**
 * Find row index (1-based) by id in a sheet
 */
function findRowIndexById(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var idColValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idColValues.length; i++) {
    if (String(idColValues[i][0]) === String(id)) {
      return i + 2; // 1-based row index
    }
  }
  return -1;
}

/**
 * Handle fine-grained batch mutations with Optimistic Locking
 */
function handleMutate(payloadStr) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var ss = getSpreadsheet();
    var payload = JSON.parse(payloadStr);
    var ops = payload.ops || [];
    var serverTime = Date.now();
    var results = [];

    // 1. Conflict Check Phase
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var table = op.table;
      var record = op.record || {};
      var baseUpdatedAt = op.baseUpdatedAt;

      if (!table || !SCHEMA[table]) {
        throw new Error('Unknown table: ' + table);
      }

      if (table === 'projects' || table === 'awardedProjects') {
        var pSheet = ss.getSheetByName('projects');
        var aSheet = ss.getSheetByName('awardedProjects');
        var existingProj = null;
        
        if (record.id) {
          if (pSheet) {
            var r1 = findRowIndexById(pSheet, record.id);
            if (r1 !== -1) {
              var objs = sheetToObjects(pSheet, SCHEMA.projects);
              existingProj = objs.find(function(p) { return p.id === record.id; });
            }
          }
          if (!existingProj && aSheet) {
            var r2 = findRowIndexById(aSheet, record.id);
            if (r2 !== -1) {
              var objsA = sheetToObjects(aSheet, SCHEMA.awardedProjects);
              existingProj = objsA.find(function(p) { return p.id === record.id; });
            }
          }
        }

        if (existingProj && baseUpdatedAt) {
          var serverUpdatedAt = existingProj.updatedAt ? Number(existingProj.updatedAt) : 0;
          var clientBase = Number(baseUpdatedAt);
          if (serverUpdatedAt > 0 && clientBase > 0 && serverUpdatedAt !== clientBase) {
            return {
              status: 'conflict',
              message: 'ข้อมูลโปรเจกต์ "' + (existingProj.name || existingProj.code || existingProj.id) + '" ถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชข้อมูล',
              conflictRecord: existingProj,
              serverTime: serverTime
            };
          }
        }
      } else {
        // Other tables
        var sheet = ss.getSheetByName(table);
        if (sheet && record.id && baseUpdatedAt) {
          var rIdx = findRowIndexById(sheet, record.id);
          if (rIdx !== -1) {
            var tableObjs = sheetToObjects(sheet, SCHEMA[table]);
            var existingRow = tableObjs.find(function(o) { return o.id === record.id; });
            if (existingRow && existingRow.updatedAt) {
              if (Number(existingRow.updatedAt) !== Number(baseUpdatedAt)) {
                return {
                  status: 'conflict',
                  message: 'ข้อมูลใน ' + table + ' (' + record.id + ') ถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชข้อมูล',
                  conflictRecord: existingRow,
                  serverTime: serverTime
                };
              }
            }
          }
        }
      }
    }

    // 2. Execution Phase
    for (var k = 0; k < ops.length; k++) {
      var opItem = ops[k];
      var opType = opItem.op;
      var tbl = opItem.table;
      var rec = opItem.record || {};

      rec.updatedAt = serverTime;

      // Fix common typos on input
      if (rec.stage === 'Cancle') rec.stage = 'Cancel';
      if (rec.businessType === 'Treading') rec.businessType = 'Trading';

      if (tbl === 'projects' || tbl === 'awardedProjects') {
        var projectsSheet = getOrCreateSheetWithHeaders(ss, 'projects');
        var awardedSheet = getOrCreateSheetWithHeaders(ss, 'awardedProjects');

        if (opType === 'upsert') {
          // Generate server ID if missing or temporary
          if (!rec.id || String(rec.id).indexOf('P-') !== 0) {
            rec.id = 'P-' + String(serverTime).slice(-6) + String(Math.floor(Math.random() * 90 + 10));
          }

          // Generate code if missing or placeholder
          if (!rec.code || rec.code.indexOf('G26-') !== 0 || rec.code.indexOf('กำลังสร้าง') !== -1) {
            rec.code = generateNextProjectCode(ss);
          }

          var targetSheet = (rec.stage === 'Award') ? awardedSheet : projectsSheet;
          var otherSheet = (rec.stage === 'Award') ? projectsSheet : awardedSheet;

          // Check if already in target sheet
          var existingInTarget = findRowIndexById(targetSheet, rec.id);
          // Check if currently in other sheet (stage transition)
          var existingInOther = findRowIndexById(otherSheet, rec.id);

          if (existingInOther !== -1) {
            otherSheet.deleteRow(existingInOther);
          }

          var rowVals = objectToRowValues(rec, SCHEMA[targetSheet.getName()]);
          if (existingInTarget !== -1) {
            targetSheet.getRange(existingInTarget, 1, 1, rowVals.length).setValues([rowVals]);
          } else {
            targetSheet.appendRow(rowVals);
          }

          results.push({ op: opType, table: targetSheet.getName(), record: rec });
        } else if (opType === 'delete') {
          var pIdx = findRowIndexById(projectsSheet, rec.id);
          if (pIdx !== -1) projectsSheet.deleteRow(pIdx);
          var aIdx = findRowIndexById(awardedSheet, rec.id);
          if (aIdx !== -1) awardedSheet.deleteRow(aIdx);

          // Cascade delete related manhours
          var mhSheet = ss.getSheetByName('manhours');
          if (mhSheet) {
            var mhLast = mhSheet.getLastRow();
            if (mhLast > 1) {
              var mhData = mhSheet.getRange(2, 1, mhLast - 1, SCHEMA.manhours.length).getValues();
              var pIdCol = SCHEMA.manhours.indexOf('projectId');
              for (var m = mhData.length - 1; m >= 0; m--) {
                if (String(mhData[m][pIdCol]) === String(rec.id)) {
                  mhSheet.deleteRow(m + 2);
                }
              }
            }
          }

          results.push({ op: opType, table: tbl, id: rec.id });
        }
      } else {
        // Members, Holidays, Manhours, CalendarNotes
        var normalSheet = getOrCreateSheetWithHeaders(ss, tbl);
        var headersList = SCHEMA[tbl];

        if (opType === 'upsert') {
          if (!rec.id) {
            var prefix = tbl === 'members' ? 'M-' : (tbl === 'holidays' ? 'H-' : (tbl === 'manhours' ? 'MH-' : 'N-'));
            rec.id = prefix + String(serverTime).slice(-6) + String(Math.floor(Math.random() * 90 + 10));
          }

          var existIdx = findRowIndexById(normalSheet, rec.id);
          var normalRow = objectToRowValues(rec, headersList);
          if (existIdx !== -1) {
            normalSheet.getRange(existIdx, 1, 1, normalRow.length).setValues([normalRow]);
          } else {
            normalSheet.appendRow(normalRow);
          }
          results.push({ op: opType, table: tbl, record: rec });
        } else if (opType === 'delete') {
          var delIdx = findRowIndexById(normalSheet, rec.id);
          if (delIdx !== -1) {
            normalSheet.deleteRow(delIdx);
          }

          // Cascade when deleting member: unassign projects & delete member's manhours
          if (tbl === 'members') {
            ['projects', 'awardedProjects'].forEach(function(pTab) {
              var s = ss.getSheetByName(pTab);
              if (s && s.getLastRow() > 1) {
                var engCol = SCHEMA[pTab].indexOf('engineer');
                var pRows = s.getRange(2, 1, s.getLastRow() - 1, SCHEMA[pTab].length).getValues();
                for (var pr = 0; pr < pRows.length; pr++) {
                  if (String(pRows[pr][engCol]) === String(rec.id)) {
                    s.getRange(pr + 2, engCol + 1).setValue('');
                  }
                }
              }
            });

            var sMh = ss.getSheetByName('manhours');
            if (sMh && sMh.getLastRow() > 1) {
              var mIdCol = SCHEMA.manhours.indexOf('memberId');
              var mhRows = sMh.getRange(2, 1, sMh.getLastRow() - 1, SCHEMA.manhours.length).getValues();
              for (var mr = mhRows.length - 1; mr >= 0; mr--) {
                if (String(mhRows[mr][mIdCol]) === String(rec.id)) {
                  sMh.deleteRow(mr + 2);
                }
              }
            }
          }

          results.push({ op: opType, table: tbl, id: rec.id });
        }
      }
    }

    return {
      status: 'ok',
      serverTime: serverTime,
      results: results
    };
  } catch (err) {
    Logger.log('Error in handleMutate: ' + err.toString());
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Retrieve database JSON from Google Sheets
 */
function getDatabaseJson() {
  try {
    var ss = getSpreadsheet();
    var db = {};
    for (var key in SCHEMA) {
      var sheet = getOrCreateSheetWithHeaders(ss, key);
      db[key] = sheetToObjects(sheet, SCHEMA[key]);
    }
    db.serverTime = Date.now();
    return JSON.stringify(db);
  } catch (err) {
    Logger.log('Error in getDatabaseJson: ' + err.toString());
    return 'null';
  }
}

/**
 * Full database restore (Used only from Settings Import with explicit confirmation)
 */
function handleReplaceAll(payloadStr) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var payload = JSON.parse(payloadStr);
    if (payload.confirm !== 'REPLACE_ALL') {
      return { status: 'error', message: 'Missing confirmation for replaceAll' };
    }
    var db = payload.data;
    if (!db || typeof db !== 'object') {
      return { status: 'error', message: 'Invalid data for replaceAll' };
    }
    var ss = getSpreadsheet();
    var now = Date.now();

    for (var key in SCHEMA) {
      var sheet = getOrCreateSheetWithHeaders(ss, key);
      var items = db[key] || [];
      items.forEach(function(item) {
        if (!item.updatedAt) item.updatedAt = now;
      });
      objectsToSheet(sheet, items, SCHEMA[key]);
    }

    return { status: 'ok', serverTime: now };
  } catch (err) {
    Logger.log('Error in handleReplaceAll: ' + err.toString());
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Migration V5: Run manually once from Apps Script editor
 * - Ensures updatedAt column in all sheets
 * - Converts base64 image data to Google Drive files
 * - Corrects typos 'Cancle' -> 'Cancel' and 'Treading' -> 'Trading'
 */
function migrateV5() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var ss = getSpreadsheet();
    var folder = getOrCreateImageFolder();
    var now = Date.now();
    var log = [];

    for (var key in SCHEMA) {
      var sheet = getOrCreateSheetWithHeaders(ss, key);
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var uCol = headers.indexOf('updatedAt');
      if (uCol === -1) {
        var nextCol = lastCol + 1;
        sheet.getRange(1, nextCol).setValue('updatedAt');
        uCol = nextCol - 1;
        log.push('Added updatedAt column to ' + key);
      }
      if (lastRow > 1) {
        var uVals = sheet.getRange(2, uCol + 1, lastRow - 1, 1).getValues();
        var needUpdate = false;
        for (var r = 0; r < uVals.length; r++) {
          if (!uVals[r][0]) {
            uVals[r][0] = now;
            needUpdate = true;
          }
        }
        if (needUpdate) {
          sheet.getRange(2, uCol + 1, uVals.length, 1).setValues(uVals);
        }
      }
    }

    var projTabs = ['projects', 'awardedProjects'];
    var convertedImages = 0;
    var fixedSpellings = 0;

    for (var t = 0; t < projTabs.length; t++) {
      var tabName = projTabs[t];
      var pSheet = ss.getSheetByName(tabName);
      if (!pSheet) continue;
      var pObjects = sheetToObjects(pSheet, SCHEMA[tabName]);
      var modified = false;

      for (var i = 0; i < pObjects.length; i++) {
        var proj = pObjects[i];

        if (proj.stage === 'Cancle') {
          proj.stage = 'Cancel';
          fixedSpellings++;
          modified = true;
        }
        if (proj.businessType === 'Treading') {
          proj.businessType = 'Trading';
          fixedSpellings++;
          modified = true;
        }

        if (proj.image && proj.image.indexOf('data:image') === 0) {
          try {
            var fileName = (proj.code || proj.id || 'project') + '_' + Date.now() + '.jpg';
            var parts = proj.image.split('base64,');
            var cType = parts[0].replace('data:', '').replace(';', '') || 'image/jpeg';
            var bData = parts[1];
            var blob = Utilities.newBlob(Utilities.base64Decode(bData), cType, fileName);
            var f = folder.createFile(blob);
            try {
              f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            } catch (e) {}
            proj.image = 'https://lh3.googleusercontent.com/d/' + f.getId();
            convertedImages++;
            modified = true;
          } catch (imgErr) {
            Logger.log('Could not convert image for ' + proj.code + ': ' + imgErr);
          }
        }

        if (!proj.updatedAt) {
          proj.updatedAt = now;
          modified = true;
        }
      }

      if (modified) {
        objectsToSheet(pSheet, pObjects, SCHEMA[tabName]);
      }
    }

    log.push('Migration V5 completed successfully.');
    log.push('Converted images to Drive: ' + convertedImages);
    log.push('Fixed typo occurrences: ' + fixedSpellings);
    var summary = log.join('\n');
    Logger.log(summary);
    return summary;
  } catch (err) {
    Logger.log('Error in migrateV5: ' + err.toString());
    throw err;
  } finally {
    lock.releaseLock();
  }
}
