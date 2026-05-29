// Required schema changes for the new Employees / Industry / Phone fields:
//   ALTER TABLE Customers ADD Employees INT NULL, Industry NVARCHAR(100) NULL;
//   ALTER TABLE Prospects ADD Phone NVARCHAR(50) NULL, Employees INT NULL, Industry NVARCHAR(100) NULL;
// Required schema for the new RevenueCategory / ExpectedStartMonth fields:
//   ALTER TABLE Prospects ADD RevenueCategory NVARCHAR(50) NULL, ExpectedStartMonth DATE NULL;
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