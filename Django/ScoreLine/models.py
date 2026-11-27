from django.db import models


class ContactMessage(models.Model):
    """A message sent from the website's contact / feedback form (POST /api/contact/)."""

    SUBJECT_CHOICES = [
        ("general", "General feedback"),
        ("prediction_accuracy", "Prediction accuracy"),
        ("bug_report", "Bug report"),
        ("feature_request", "Feature request"),
        ("other", "Other"),
    ]

    full_name = models.CharField(max_length=100)
    email = models.EmailField(max_length=100)
    phone = models.CharField(max_length=20, blank=True)
    subject = models.CharField(max_length=30, choices=SUBJECT_CHOICES)
    message = models.TextField(max_length=1000)
    rating = models.PositiveSmallIntegerField(null=True, blank=True)
    page = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_subject_display()} from {self.full_name} ({self.created_at:%Y-%m-%d})"
