// Required schema changes for the new Employees / Industry / Phone fields:
//   ALTER TABLE Customers ADD Employees INT NULL, Industry NVARCHAR(100) NULL;
//   ALTER TABLE Prospects ADD Phone NVARCHAR(50) NULL, Employees INT NULL, Industry NVARCHAR(100) NULL;
// Required schema for the new RevenueCategory / ExpectedStartMonth fields:
//   ALTER TABLE Prospects ADD RevenueCategory NVARCHAR(50) NULL, ExpectedStartMonth DATE NULL;
// Required schema for invoice tracking on revenue items:
//   ALTER TABLE CustomerRevenues ADD InvoiceDate DATE NULL, Paid BIT DEFAULT 0, PaymentDate DATE NULL;
//   ALTER TABLE ProspectRevenues ADD InvoiceDate DATE NULL, Paid BIT DEFAULT 0, PaymentDate DATE NULL;
// Risk-snapshot / renewal-outcome tables:
//   CREATE TABLE RiskSnapshots (
//     Id INT IDENTITY(1,1) PRIMARY KEY,
//     CustomerId INT NOT NULL,
//     CreatedAt DATETIME DEFAULT GETDATE(),
//     TriggerType NVARCHAR(50) NOT NULL,  -- manual, auto_90d, auto_30d, auto_15d
//     Score INT, RiskLevel NVARCHAR(20), RenewalProb INT,
//     StepBase INT, Satisfaction INT, ActivityLevel NVARCHAR(30),
//     Economy NVARCHAR(30), Focus NVARCHAR(30), DaysToLicenseEnd INT
//   );
//   CREATE TABLE RenewalOutcomes (
//     Id INT IDENTITY(1,1) PRIMARY KEY,
//     CustomerId INT NOT NULL,
//     RiskSnapshotId INT NULL,
//     Outcome NVARCHAR(30) NOT NULL,  -- Förnyade, Churnade, Pausad, Ej registrerat
//     DecisionDate DATE NULL,
//     Notes NVARCHAR(MAX) NULL,
//     CreatedAt DATETIME DEFAULT GETDATE()
//   );
// Until those columns exist the corresponding PUT/POST below will fail with
// "Invalid column name" — run the ALTER TABLE statements first.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const sql = require('mssql');

const config = {
  server: 'ciboost-server.database.windows.net',
  database: 'ciboost-db',
  user: 'ciboostadmin',
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false }
};

let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(config);
  return pool;
}

function calculateRiskScore({ steps = [], satisfaction = 0, activityLevel = '', economy = 'unknown', focus = 'unknown' } = {}) {
  const stepPoints = [5, 10, 35, 65, 95, 100];
  let stepBase = 0;
  for (let i = 0; i < 6; i++) if (steps[i]) stepBase = stepPoints[i];
  let score = stepBase;
  const satAdj = { 1: -100, 2: -75, 3: -25, 4: 0, 5: 25 };
  score += satAdj[satisfaction] || 0;
  const actAdj = { '': -50, 'ingen': -50, 'Låg': -25, 'låg': -25, 'Medium': 25, 'medium': 25, 'Hög': 50, 'hög': 50 };
  score += actAdj[activityLevel] != null ? actAdj[activityLevel] : 0;
  const ecoAdj = { large_savings: -50, savings: -25, unknown: 0, good: 25 };
  score += ecoAdj[economy] != null ? ecoAdj[economy] : 0;
  const focAdj = { strong_other: -50, other: -25, unknown: 0, priority: 25 };
  score += focAdj[focus] != null ? focAdj[focus] : 0;
  const riskLevel = score < 50 ? 'Hög' : score <= 120 ? 'Medium' : 'Låg';
  const anchors = [[-150, 5], [0, 45], [50, 55], [120, 80], [200, 95]];
  let prob;
  if (score <= anchors[0][0]) prob = anchors[0][1];
  else if (score >= anchors[anchors.length - 1][0]) prob = anchors[anchors.length - 1][1];
  else {
    for (let i = 0; i < anchors.length - 1; i++) {
      const [x1, y1] = anchors[i], [x2, y2] = anchors[i + 1];
      if (score >= x1 && score <= x2) { prob = y1 + (y2 - y1) * ((score - x1) / (x2 - x1)); break; }
    }
  }
  const renewalProb = Math.round(Math.max(5, Math.min(95, prob)));
  return { score, stepBase, riskLevel, renewalProb };
}

async function insertRiskSnapshot(db, row) {
  return db.request()
    .input('CustomerId', sql.Int, row.customerId)
    .input('TriggerType', sql.NVarChar, row.triggerType || 'manual')
    .input('Score', sql.Int, row.score)
    .input('RiskLevel', sql.NVarChar, row.riskLevel)
    .input('RenewalProb', sql.Int, row.renewalProb)
    .input('StepBase', sql.Int, row.stepBase || 0)
    .input('Satisfaction', sql.Int, row.satisfaction || 0)
    .input('ActivityLevel', sql.NVarChar, row.activityLevel || '')
    .input('Economy', sql.NVarChar, row.economy || 'unknown')
    .input('Focus', sql.NVarChar, row.focus || 'unknown')
    .input('DaysToLicenseEnd', sql.Int, row.daysToLicenseEnd != null ? row.daysToLicenseEnd : null)
    .query(`INSERT INTO RiskSnapshots (CustomerId,TriggerType,Score,RiskLevel,RenewalProb,StepBase,Satisfaction,ActivityLevel,Economy,Focus,DaysToLicenseEnd)
            OUTPUT INSERTED.Id, INSERTED.CreatedAt
            VALUES (@CustomerId,@TriggerType,@Score,@RiskLevel,@RenewalProb,@StepBase,@Satisfaction,@ActivityLevel,@Economy,@Focus,@DaysToLicenseEnd)`);
}

module.exports = async function (context, req) {
  const method = req.method.toUpperCase();
  const path = req.params.path || '';

  if (method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const db = await getPool();

    if (path === 'prospects') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM Prospects ORDER BY CreatedAt DESC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const p = req.body;
        await db.request()
          .input('Company', sql.NVarChar, p.company)
          .input('Industry', sql.NVarChar, p.industry || null)
          .input('Contact', sql.NVarChar, p.contact)
          .input('Role', sql.NVarChar, p.role)
          .input('Phone', sql.NVarChar, p.phone || null)
          .input('Employees', sql.Int, p.employees || null)
          .input('Source', sql.NVarChar, p.source)
          .input('Owner', sql.NVarChar, p.owner)
          .input('Stage', sql.NVarChar, p.stage)
          .input('Score', sql.Int, p.score)
          .input('Value', sql.Int, p.value)
          .input('Probability', sql.Int, p.probability)
          .input('LastContact', sql.Date, p.lastContact || null)
          .input('NextMeeting', sql.Date, p.nextMeeting || null)
          .input('Notes', sql.NVarChar, p.notes)
          .input('RevenueCategory', sql.NVarChar, p.revenueCategory || null)
          .input('ExpectedStartMonth', sql.Date, p.expectedStartMonth || null)
          .query(`INSERT INTO Prospects (Company,Industry,Contact,Role,Phone,Employees,Source,Owner,Stage,Score,Value,Probability,LastContact,NextMeeting,Notes,RevenueCategory,ExpectedStartMonth)
                  VALUES (@Company,@Industry,@Contact,@Role,@Phone,@Employees,@Source,@Owner,@Stage,@Score,@Value,@Probability,@LastContact,@NextMeeting,@Notes,@RevenueCategory,@ExpectedStartMonth)`);
        return respond(context, 201, { message: 'Skapad' });
      }
    }

    if (path.startsWith('prospects/')) {
      const id = path.split('/')[1];
      if (method === 'PUT') {
        const p = req.body;
        await db.request()
          .input('Id', sql.Int, id)
          .input('Company', sql.NVarChar, p.company)
          .input('Industry', sql.NVarChar, p.industry || null)
          .input('Contact', sql.NVarChar, p.contact)
          .input('Role', sql.NVarChar, p.role)
          .input('Phone', sql.NVarChar, p.phone || null)
          .input('Employees', sql.Int, p.employees || null)
          .input('Source', sql.NVarChar, p.source)
          .input('Owner', sql.NVarChar, p.owner)
          .input('Stage', sql.NVarChar, p.stage)
          .input('Score', sql.Int, p.score)
          .input('Value', sql.Int, p.value)
          .input('Probability', sql.Int, p.probability)
          .input('LastContact', sql.Date, p.lastContact || null)
          .input('NextMeeting', sql.Date, p.nextMeeting || null)
          .input('Notes', sql.NVarChar, p.notes)
          .input('RevenueCategory', sql.NVarChar, p.revenueCategory || null)
          .input('ExpectedStartMonth', sql.Date, p.expectedStartMonth || null)
          .query(`UPDATE Prospects SET Company=@Company,Industry=@Industry,Contact=@Contact,Role=@Role,
                  Phone=@Phone,Employees=@Employees,
                  Source=@Source,Owner=@Owner,Stage=@Stage,Score=@Score,Value=@Value,Probability=@Probability,
                  LastContact=@LastContact,NextMeeting=@NextMeeting,Notes=@Notes,
                  RevenueCategory=@RevenueCategory,ExpectedStartMonth=@ExpectedStartMonth,
                  UpdatedAt=GETDATE() WHERE Id=@Id`);
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, id)
          .query('DELETE FROM Activities WHERE ProspectId=@Id; DELETE FROM Prospects WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path === 'customers') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM Customers ORDER BY LicenseEnd ASC');
        // Auto-snapshot: for customers with LicenseEnd exactly 90/30/15 days from now,
        // insert a RiskSnapshot unless one with the same TriggerType exists within last 3 days.
        try {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const triggers = { 90: 'auto_90d', 30: 'auto_30d', 15: 'auto_15d' };
          for (const c of result.recordset) {
            if (!c.LicenseEnd) continue;
            const end = new Date(c.LicenseEnd); end.setHours(0, 0, 0, 0);
            const daysLeft = Math.round((end - today) / 86400000);
            const trig = triggers[daysLeft];
            if (!trig) continue;
            const existing = await db.request()
              .input('CustomerId', sql.Int, c.Id)
              .input('TriggerType', sql.NVarChar, trig)
              .query("SELECT TOP 1 Id FROM RiskSnapshots WHERE CustomerId=@CustomerId AND TriggerType=@TriggerType AND CreatedAt >= DATEADD(day,-3,GETDATE())");
            if (existing.recordset.length) continue;
            const r = calculateRiskScore({ steps: [], satisfaction: 0, activityLevel: '', economy: 'unknown', focus: 'unknown' });
            try { await insertRiskSnapshot(db, { customerId: c.Id, triggerType: trig, score: r.score, riskLevel: r.riskLevel, renewalProb: r.renewalProb, stepBase: r.stepBase, daysToLicenseEnd: daysLeft }); }
            catch (e) { context.log && context.log('auto-snapshot insert failed', c.Id, e.message); }
          }
        } catch (e) { context.log && context.log('auto-snapshot scan failed', e.message); }
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const c = req.body;
        await db.request()
          .input('Company', sql.NVarChar, c.company)
          .input('Contact', sql.NVarChar, c.contact)
          .input('Source', sql.NVarChar, c.source)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr)
          .input('Risk', sql.NVarChar, c.risk)
          .input('Notes', sql.NVarChar, c.notes)
          .input('ParentCompany', sql.NVarChar, c.parentCompany || null)
          .input('Employees', sql.Int, c.employees || null)
          .input('Industry', sql.NVarChar, c.industry || null)
          .query(`INSERT INTO Customers (Company,Contact,Source,LicenseType,LicenseStart,LicenseEnd,ARR,Risk,Notes,ParentCompany,Employees,Industry)
                  VALUES (@Company,@Contact,@Source,@LicenseType,@LicenseStart,@LicenseEnd,@ARR,@Risk,@Notes,@ParentCompany,@Employees,@Industry)`);
        return respond(context, 201, { message: 'Kund skapad' });
      }
    }

    if (path.startsWith('customers/') && !path.includes('/teams') && !path.includes('/admins') && !path.includes('/revenues')) {
      const id = path.split('/')[1];

      if (method === 'PUT') {
        const c = req.body;
        await db.request()
          .input('Id', sql.Int, id)
          .input('Company', sql.NVarChar, c.company)
          .input('SubName', sql.NVarChar, c.subName || null)
          .input('Contact', sql.NVarChar, c.contact)
          .input('ContactRole', sql.NVarChar, c.contactRole || null)
          .input('ContactEmail', sql.NVarChar, c.contactEmail || null)
          .input('ContactPhone', sql.NVarChar, c.contactPhone || null)
          .input('CustomerSince', sql.Date, c.customerSince || null)
          .input('Owner', sql.NVarChar, c.owner)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr || null)
          .input('ARR_Fixed', sql.Int, c.arrFixed || null)
          .input('Revenue_Training', sql.Int, c.revenueTraining || null)
          .input('Revenue_Training_Date', sql.Date, c.revenueTrainingDate || null)
          .input('Revenue_Consulting', sql.Int, c.revenueConsulting || null)
          .input('Revenue_Consulting_Date', sql.Date, c.revenueConsultingDate || null)
          .input('Risk', sql.NVarChar, c.risk)
          .input('Notes', sql.NVarChar, c.notes || null)
          .input('ParentCompany', sql.NVarChar, c.parentCompany || null)
          .input('Employees', sql.Int, c.employees || null)
          .input('Industry', sql.NVarChar, c.industry || null)
          .query(`UPDATE Customers SET
            Company=@Company, SubName=@SubName, Contact=@Contact, ContactRole=@ContactRole,
            ContactEmail=@ContactEmail, ContactPhone=@ContactPhone, CustomerSince=@CustomerSince,
            Owner=@Owner, LicenseType=@LicenseType, LicenseStart=@LicenseStart, LicenseEnd=@LicenseEnd,
            ARR=@ARR, ARR_Fixed=@ARR_Fixed, Revenue_Training=@Revenue_Training,
            Revenue_Training_Date=@Revenue_Training_Date, Revenue_Consulting=@Revenue_Consulting,
            Revenue_Consulting_Date=@Revenue_Consulting_Date, Risk=@Risk, Notes=@Notes,
            ParentCompany=@ParentCompany, Employees=@Employees, Industry=@Industry
            WHERE Id=@Id`);
        return respond(context, 200, { message: 'Uppdaterad' });
      }

      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, id)
          .query('DELETE FROM Customers WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    // Koncern-sökning
    if (path === 'customers/by-parent' && method === 'GET') {
      const parent = req.query.name;
      const result = await db.request()
        .input('ParentCompany', sql.NVarChar, parent)
        .query('SELECT * FROM Customers WHERE ParentCompany=@ParentCompany ORDER BY LicenseEnd ASC');
      return respond(context, 200, result.recordset);
    }

    if (path === 'activities' && method === 'POST') {
      const a = req.body;
      await db.request()
        .input('ProspectId', sql.Int, a.prospectId)
        .input('Type', sql.NVarChar, a.type)
        .input('Note', sql.NVarChar, a.note)
        .input('CreatedBy', sql.NVarChar, a.createdBy)
        .query('INSERT INTO Activities (ProspectId,Type,Note,CreatedBy) VALUES (@ProspectId,@Type,@Note,@CreatedBy)');
      return respond(context, 201, { message: 'Aktivitet sparad' });
    }

    if (path.startsWith('activities/prospect/')) {
      const id = path.split('/')[2];
      const result = await db.request().input('ProspectId', sql.Int, id)
        .query('SELECT * FROM Activities WHERE ProspectId=@ProspectId ORDER BY CreatedAt DESC');
      return respond(context, 200, result.recordset);
    }

    if (path.startsWith('budget-versions/') && !path.includes('/rows')) {
      const versionId = path.split('/')[1];
      if (method === 'PUT') {
        const b = req.body;
        await db.request()
          .input('Id', sql.Int, versionId)
          .input('Name', sql.NVarChar, b.name)
          .input('Year', sql.Int, b.year)
          .query('UPDATE BudgetVersions SET Name=@Name, Year=@Year WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, versionId)
          .query('DELETE FROM BudgetRows WHERE VersionId=@Id; DELETE FROM BudgetVersions WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path === 'riskSnapshot' && method === 'POST') {
      const b = req.body || {};
      if (!b.customerId) return respond(context, 400, { message: 'customerId krävs' });
      const r = calculateRiskScore(b);
      const ins = await insertRiskSnapshot(db, {
        customerId: b.customerId,
        triggerType: b.triggerType || 'manual',
        score: r.score, riskLevel: r.riskLevel, renewalProb: r.renewalProb, stepBase: r.stepBase,
        satisfaction: b.satisfaction || 0, activityLevel: b.activityLevel || '',
        economy: b.economy || 'unknown', focus: b.focus || 'unknown',
        daysToLicenseEnd: b.daysToLicenseEnd != null ? b.daysToLicenseEnd : null
      });
      const row = ins.recordset[0];
      return respond(context, 201, { id: row.Id, createdAt: row.CreatedAt, ...r });
    }

    if (path === 'renewalOutcome' && method === 'POST') {
      const b = req.body || {};
      if (!b.customerId || !b.outcome) return respond(context, 400, { message: 'customerId och outcome krävs' });
      const latest = await db.request()
        .input('CustomerId', sql.Int, b.customerId)
        .query('SELECT TOP 1 Id FROM RiskSnapshots WHERE CustomerId=@CustomerId ORDER BY CreatedAt DESC');
      const snapId = latest.recordset[0] ? latest.recordset[0].Id : null;
      await db.request()
        .input('CustomerId', sql.Int, b.customerId)
        .input('RiskSnapshotId', sql.Int, snapId)
        .input('Outcome', sql.NVarChar, b.outcome)
        .input('DecisionDate', sql.Date, b.decisionDate || null)
        .input('Notes', sql.NVarChar, b.notes || null)
        .query(`INSERT INTO RenewalOutcomes (CustomerId,RiskSnapshotId,Outcome,DecisionDate,Notes)
                VALUES (@CustomerId,@RiskSnapshotId,@Outcome,@DecisionDate,@Notes)`);
      return respond(context, 201, { message: 'Sparad', riskSnapshotId: snapId });
    }

    if (path === 'modelAnalysis' && method === 'GET') {
      const snaps = (await db.request().query('SELECT * FROM RiskSnapshots ORDER BY CreatedAt DESC')).recordset;
      const outs = (await db.request().query('SELECT * FROM RenewalOutcomes ORDER BY CreatedAt DESC')).recordset;
      // Pair each outcome with its linked snapshot (or latest snapshot prior to outcome)
      const snapById = {}; snaps.forEach(s => { snapById[s.Id] = s; });
      const paired = outs.map(o => {
        let snap = o.RiskSnapshotId ? snapById[o.RiskSnapshotId] : null;
        if (!snap) {
          const cand = snaps.filter(s => s.CustomerId === o.CustomerId && new Date(s.CreatedAt) <= new Date(o.CreatedAt));
          snap = cand[0] || null;
        }
        return { outcome: o, snapshot: snap };
      }).filter(p => p.snapshot);
      // Calibration buckets (predicted renewalProb)
      const buckets = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
      const calibration = buckets.map(([lo, hi]) => {
        const inB = paired.filter(p => p.snapshot.RenewalProb >= lo && p.snapshot.RenewalProb < (hi === 100 ? 101 : hi));
        const renewed = inB.filter(p => p.outcome.Outcome === 'Förnyade').length;
        const total = inB.length;
        return { bucket: `${lo}-${hi}%`, predicted: (lo + hi) / 2, actual: total ? Math.round(renewed / total * 100) : null, n: total };
      });
      // Misclassification: predicted Hög but renewed, or predicted Låg but churned
      const misclassified = paired.filter(p => {
        const pred = p.snapshot.RiskLevel;
        const out = p.outcome.Outcome;
        return (pred === 'Hög' && out === 'Förnyade') || (pred === 'Låg' && out === 'Churnade');
      }).map(p => ({
        customerId: p.outcome.CustomerId,
        snapshotDate: p.snapshot.CreatedAt,
        predictedLevel: p.snapshot.RiskLevel,
        predictedProb: p.snapshot.RenewalProb,
        actualOutcome: p.outcome.Outcome,
        decisionDate: p.outcome.DecisionDate
      }));
      // Confusion matrix
      const levels = ['Hög', 'Medium', 'Låg'];
      const outcomes = ['Förnyade', 'Churnade', 'Pausad', 'Ej registrerat'];
      const matrix = {};
      levels.forEach(l => { matrix[l] = {}; outcomes.forEach(o => matrix[l][o] = 0); });
      paired.forEach(p => { if (matrix[p.snapshot.RiskLevel]) matrix[p.snapshot.RiskLevel][p.outcome.Outcome] = (matrix[p.snapshot.RiskLevel][p.outcome.Outcome] || 0) + 1; });
      // Factor contribution: correlation between each factor's adjustment and renewal-success
      const factorKeys = ['StepBase', 'Satisfaction', 'ActivityLevel', 'Economy', 'Focus'];
      const factorScore = (snap, key) => {
        if (key === 'StepBase') return snap.StepBase || 0;
        if (key === 'Satisfaction') return ({ 1: -100, 2: -75, 3: -25, 4: 0, 5: 25 })[snap.Satisfaction] || 0;
        if (key === 'ActivityLevel') { const m = { '': -50, 'ingen': -50, 'Låg': -25, 'låg': -25, 'Medium': 25, 'medium': 25, 'Hög': 50, 'hög': 50 }; return m[snap.ActivityLevel] != null ? m[snap.ActivityLevel] : 0; }
        if (key === 'Economy') { const m = { large_savings: -50, savings: -25, unknown: 0, good: 25 }; return m[snap.Economy] != null ? m[snap.Economy] : 0; }
        if (key === 'Focus') { const m = { strong_other: -50, other: -25, unknown: 0, priority: 25 }; return m[snap.Focus] != null ? m[snap.Focus] : 0; }
        return 0;
      };
      const factorContribution = factorKeys.map(k => {
        // Pearson-like: avg factor value when renewed vs avg when not
        const renewed = paired.filter(p => p.outcome.Outcome === 'Förnyade').map(p => factorScore(p.snapshot, k));
        const churned = paired.filter(p => p.outcome.Outcome === 'Churnade').map(p => factorScore(p.snapshot, k));
        const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
        const lift = avg(renewed) - avg(churned);
        return { factor: k, avgRenewed: Math.round(avg(renewed) * 10) / 10, avgChurned: Math.round(avg(churned) * 10) / 10, predictiveLift: Math.round(lift * 10) / 10 };
      }).sort((a, b) => Math.abs(b.predictiveLift) - Math.abs(a.predictiveLift));
      // Weight suggestion (locked until >= 20 outcomes)
      const totalOutcomes = outs.length;
      let suggestedWeights = null;
      if (totalOutcomes >= 20) {
        // Suggest scaling each factor's base weight by (predictiveLift / maxLift); cap at 2x and floor at 0.5x
        const maxLift = Math.max(...factorContribution.map(f => Math.abs(f.predictiveLift)), 1);
        suggestedWeights = {};
        factorContribution.forEach(f => {
          const scale = Math.max(0.5, Math.min(2, Math.abs(f.predictiveLift) / maxLift * 1.5));
          suggestedWeights[f.factor] = Math.round(scale * 100) / 100;
        });
      }
      return respond(context, 200, {
        totalSnapshots: snaps.length, totalOutcomes, pairedCount: paired.length,
        calibration, misclassified, confusionMatrix: matrix, factorContribution,
        weightsLocked: totalOutcomes < 20, suggestedWeights, outcomesNeeded: Math.max(0, 20 - totalOutcomes)
      });
    }

    return respond(context, 404, { message: 'Endpoint hittades inte' });

  } catch (err) {
    return respond(context, 500, { message: 'Serverfel', error: err.message });
  }
};

function respond(context, status, body) {
  context.res = {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}