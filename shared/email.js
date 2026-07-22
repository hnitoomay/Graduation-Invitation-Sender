const { DEFAULT_SUBJECT, SESSION_LABELS } = require("./constants");

function renderSubject(studentName, subjectTemplate = DEFAULT_SUBJECT) {
  return subjectTemplate.replace("{{studentName}}", studentName);
}

function buildEmailModel(student, template) {
  const session = SESSION_LABELS[student.sessionKey];
  return {
    studentName: student.studentName,
    sessionLabel: session.label,
    sessionTime: session.time,
    arrivalTime: session.arrival,
    subject: renderSubject(student.studentName),
    html: template.render({
      studentName: student.studentName,
      sessionLabel: session.label,
      sessionTime: session.time,
      arrivalTime: session.arrival
    }),
    text: template.renderText({
      studentName: student.studentName,
      sessionLabel: session.label,
      sessionTime: session.time,
      arrivalTime: session.arrival
    })
  };
}

module.exports = {
  renderSubject,
  buildEmailModel
};
